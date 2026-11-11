import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

async function setup() {
  let now = Date.now();
  const app = await buildApp({ dbPath: ":memory:", clock: () => now });
  const register = async (email: string) =>
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email,
          name: email.split("@")[0],
          password: "Correct-Horse-123",
        },
      })
    ).json();
  const owner = await register("owner@example.test"),
    guest = await register("guest@example.test"),
    other = await register("other@example.test");
  const headers = (user = owner) => ({ authorization: `Bearer ${user.token}` });
  const workspace = app.store.createWorkspace(owner.user.id, "Team");
  const base = `/api/workspaces/${workspace.id}/collaborations`;
  const a = (
    await app.inject({
      method: "POST",
      url: base,
      headers: headers(),
      payload: { name: "Private agreement" },
    })
  ).json();
  const url = `${base}/${a.id}`;
  const create = async (user = owner) =>
    app.inject({
      method: "POST",
      url: `${url}/invitation-links`,
      headers: headers(user),
      payload: {},
    });
  const accept = async (token: string, user = guest) =>
    app.inject({
      method: "POST",
      url: "/api/agreement-invitations/accept",
      headers: headers(user),
      payload: { token },
    });
  return {
    app,
    owner,
    guest,
    other,
    workspace,
    a,
    url,
    headers,
    create,
    accept,
    advance: () => {
      now += 48 * 3600000;
    },
  };
}
test("agreement link grants only the named draft roster, atomically and once; preview reveals no document", async () => {
  const f = await setup();
  const { app } = f;
  try {
    assert.equal((await f.create(f.other)).statusCode, 404);
    const created = await f.create();
    assert.equal(created.statusCode, 201, created.body);
    const invite = created.json().invitation;
    const stored = app.store.db
      .prepare("SELECT * FROM fairshare_agreement_invites")
      .get();
    assert(!JSON.stringify(stored).includes(invite.token));
    assert(
      !JSON.stringify(
        app.store.db.prepare("SELECT * FROM audit").all(),
      ).includes(invite.token),
    );
    // Signed out: the token alone opens a minimal preview.
    const signedOut = await app.inject({
      method: "POST",
      url: "/api/agreement-invitations/preview",
      payload: { token: invite.token },
    });
    assert.equal(signedOut.statusCode, 200, signedOut.body);
    assert.equal(signedOut.headers["cache-control"], "no-store");
    assert.deepEqual(Object.keys(signedOut.json()).sort(), [
      "agreementName",
      "expiresAt",
      "inviterName",
    ]);
    assert.equal(signedOut.json().agreementName, "Private agreement");
    assert.equal(signedOut.json().inviterName, "owner");
    const preview = await app.inject({
      method: "POST",
      url: "/api/agreement-invitations/preview",
      headers: f.headers(f.guest),
      payload: { token: invite.token },
    });
    assert.equal(preview.statusCode, 200);
    assert.deepEqual(preview.json(), signedOut.json());
    // Accepting still needs a session.
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/agreement-invitations/accept",
          payload: { token: invite.token },
        })
      ).statusCode,
      401,
    );
    const accepted = await f.accept(invite.token);
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().workspace.role, "MEMBER");
    assert.equal(
      accepted
        .json()
        .agreement.value.members.find((m: any) => m.userId === f.guest.user.id)
        .role,
      "COLLABORATOR",
    );
    assert.equal(accepted.json().agreement.value.versions.length, 0);
    assert.equal((await f.accept(invite.token, f.other)).statusCode, 400);
    const otherAgreement = (
      await app.inject({
        method: "POST",
        url: `/api/workspaces/${f.workspace.id}/collaborations`,
        headers: f.headers(),
        payload: { name: "Another" },
      })
    ).json();
    assert.equal(
      (
        await app.inject({
          url: `/api/workspaces/${f.workspace.id}/collaborations/${otherAgreement.id}`,
          headers: f.headers(f.guest),
        })
      ).statusCode,
      403,
    );
    const status = await app.inject({
      url: `${f.url}/recipient-status`,
      headers: f.headers(f.guest),
    });
    assert.deepEqual(status.json(), { configured: false });
    const saved = await app.inject({
      method: "PUT",
      url: "/api/auth/payout-account",
      headers: f.headers(f.guest),
      payload: { email: "guest@example.com" },
    });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(
      (
        await app.inject({
          url: `${f.url}/recipient-status`,
          headers: f.headers(f.guest),
        })
      ).json(),
      { configured: true },
    );
    // A legacy per-workspace PayPal ID still counts until an email is added.
    app.store.db
      .prepare("DELETE FROM fairshare_payout_accounts WHERE user_id=?")
      .run(f.guest.user.id);
    app.store.db
      .prepare("INSERT INTO fairshare_recipients VALUES(?,?,?)")
      .run(f.workspace.id, f.guest.user.id, "ABCDEFGHIJKLM");
    assert.deepEqual(
      (
        await app.inject({
          url: `${f.url}/recipient-status`,
          headers: f.headers(f.guest),
        })
      ).json(),
      { configured: true },
    );
  } finally {
    await app.close();
  }
});
test("draft lock after issue does not consume token or partially join workspace", async () => {
  const f = await setup();
  try {
    const invite = (await f.create()).json().invitation;
    const value = f.a.value;
    // The lock now starts when rules are sent, not when a draft exists.
    value.versions = [{ id: 1, status: "AWAITING_APPROVAL" }];
    f.app.store.db
      .prepare("UPDATE fairshare_collaborations SET value=? WHERE id=?")
      .run(JSON.stringify(value), f.a.id);
    const response = await f.accept(invite.token);
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(
      f.app.store.db
        .prepare("SELECT * FROM memberships WHERE workspace_id=? AND user_id=?")
        .get(f.workspace.id, f.guest.user.id),
      undefined,
    );
    assert.equal(
      (
        f.app.store.db
          .prepare(
            "SELECT accepted_at FROM fairshare_agreement_invites WHERE id=?",
          )
          .get(invite.id) as any
      ).accepted_at,
      null,
    );
    assert.equal((await f.create()).statusCode, 409);
  } finally {
    await f.app.close();
  }
});
test("signed-out preview rejects used, revoked and expired links and is rate limited per IP", async () => {
  const f = await setup();
  const preview = (token: unknown, remoteAddress = "203.0.113.1") =>
    f.app.inject({
      method: "POST",
      url: "/api/agreement-invitations/preview",
      remoteAddress,
      payload: { token },
    });
  try {
    const used = (await f.create()).json().invitation;
    assert.equal((await f.accept(used.token)).statusCode, 200);
    assert.equal((await preview(used.token)).statusCode, 400);
    const revoked = (await f.create()).json().invitation;
    await f.app.inject({
      method: "DELETE",
      url: `${f.url}/invitation-links/${revoked.id}`,
      headers: f.headers(),
    });
    assert.equal((await preview(revoked.token)).statusCode, 400);
    const expired = (await f.create()).json().invitation;
    f.advance();
    const expiredPreview = await preview(expired.token);
    assert.equal(expiredPreview.statusCode, 400);
    assert.equal(expiredPreview.headers["cache-control"], "no-store");
    assert.equal((await preview("not-a-token")).statusCode, 400);
    const live = (await f.create()).json().invitation;
    for (let i = 0; i < 60; i++)
      assert.notEqual(
        (await preview(live.token, "203.0.113.9")).statusCode,
        429,
      );
    assert.equal((await preview(live.token, "203.0.113.9")).statusCode, 429);
    // Another address keeps its own budget.
    assert.equal((await preview(live.token, "203.0.113.10")).statusCode, 200);
  } finally {
    await f.app.close();
  }
});
test("revocation, expiration and viewer restrictions preserve permissions", async () => {
  const f = await setup();
  try {
    const invite = (await f.create()).json().invitation;
    f.app.store.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(f.workspace.id, f.guest.user.id, "VIEWER");
    assert.equal((await f.accept(invite.token)).statusCode, 403);
    const revoked = await f.app.inject({
      method: "DELETE",
      url: `${f.url}/invitation-links/${invite.id}`,
      headers: f.headers(),
    });
    assert.equal(revoked.statusCode, 200);
    assert.equal((await f.accept(invite.token, f.other)).statusCode, 400);
    const expired = (await f.create()).json().invitation;
    f.advance();
    assert.equal((await f.accept(expired.token, f.other)).statusCode, 400);
    assert.equal(
      (
        await f.app.inject({
          url: `${f.url}/recipient-status`,
          headers: f.headers(f.other),
        })
      ).statusCode,
      404,
    );
  } finally {
    await f.app.close();
  }
});
test("existing workspace member can join draft without role escalation", async () => {
  const f = await setup();
  try {
    f.app.store.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(f.workspace.id, f.guest.user.id, "MEMBER");
    const invite = (await f.create()).json().invitation;
    const response = await f.accept(invite.token);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().workspace.role, "MEMBER");
  } finally {
    await f.app.close();
  }
});
test("organizer can invite named people, list statuses without tokens, and others cannot list", async () => {
  const f = await setup();
  const { app } = f;
  const invite = (payload: unknown, user = f.owner) =>
    app.inject({
      method: "POST",
      url: `${f.url}/invitation-links`,
      headers: f.headers(user),
      payload: payload as any,
    });
  const list = (user = f.owner) =>
    app.inject({
      url: `${f.url}/invitation-links`,
      headers: f.headers(user),
    });
  try {
    const created = await invite({
      name: "  Jordan Lee ",
      email: "Jordan@Example.TEST",
      role: "COLLABORATOR",
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.deepEqual(created.json().invitation.invitee, {
      name: "Jordan Lee",
      email: "jordan@example.test",
      role: "COLLABORATOR",
    });
    const auditRows = JSON.stringify(
      app.store.db.prepare("SELECT * FROM audit").all(),
    );
    assert(!auditRows.includes("jordan@example.test"));

    for (const bad of [
      { name: "Jordan" },
      { name: "", email: "a@b.co", role: "COLLABORATOR" },
      { name: "x".repeat(81), email: "a@b.co", role: "COLLABORATOR" },
      { name: "Jordan", email: "not-an-email", role: "COLLABORATOR" },
      {
        name: "Jordan",
        email: `${"a".repeat(250)}@b.co`,
        role: "COLLABORATOR",
      },
      { name: "Jordan", email: "a@b.co", role: "ORGANIZER" },
      { name: 42, email: "a@b.co", role: "COLLABORATOR" },
    ]) {
      const response = await invite(bad);
      assert.equal(response.statusCode, 400, JSON.stringify(bad));
      assert.equal(response.json().error.code, "INVALID_INVITEE");
    }

    const legacy = (await invite({})).json().invitation;
    assert.equal(legacy.invitee, null);
    const revoked = (
      await invite({
        name: "Riley",
        email: "riley@example.test",
        role: "COLLABORATOR",
      })
    ).json().invitation;
    await app.inject({
      method: "DELETE",
      url: `${f.url}/invitation-links/${revoked.id}`,
      headers: f.headers(),
    });
    const accepted = (
      await invite({
        name: "Guest",
        email: "guest@example.test",
        role: "COLLABORATOR",
      })
    ).json().invitation;
    assert.equal((await f.accept(accepted.token)).statusCode, 200);
    const pending = (
      await invite({
        name: "Sam",
        email: "sam@example.test",
        role: "COLLABORATOR",
      })
    ).json().invitation;

    // Non-organizers (non-member, and an accepted collaborator) cannot list.
    assert.equal((await list(f.other)).statusCode, 404);
    assert.equal((await list(f.guest)).statusCode, 403);

    const listed = await list();
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.headers["cache-control"], "no-store");
    const invitations = listed.json().invitations;
    assert.deepEqual(
      invitations.map((i: any) => [i.id, i.status]),
      [
        [pending.id, "PENDING"],
        [accepted.id, "ACCEPTED"],
        [revoked.id, "REVOKED"],
        [legacy.id, "PENDING"],
        [created.json().invitation.id, "PENDING"],
      ],
    );
    assert.deepEqual(invitations[1].acceptedBy, {
      userId: f.guest.user.id,
      name: "guest",
    });
    assert.equal(invitations[0].acceptedBy, undefined);
    assert.equal(invitations[3].invitee, null);
    const body = listed.body;
    for (const token of [
      legacy.token,
      revoked.token,
      accepted.token,
      pending.token,
    ])
      assert(!body.includes(token));
    assert(!/hash|token/i.test(body));

    f.advance();
    const later = (await list()).json().invitations;
    assert.equal(later[0].status, "EXPIRED");
    assert.equal(later[1].status, "ACCEPTED");
  } finally {
    await app.close();
  }
});
test("legacy invite rows without invitee columns still list and accept", async () => {
  const f = await setup();
  try {
    const invite = (await f.create()).json().invitation;
    // Simulate a row written before invitee/accepted_by existed.
    f.app.store.db
      .prepare(
        "UPDATE fairshare_agreement_invites SET invitee_name=NULL,invitee_email=NULL,invitee_role=NULL,accepted_by=NULL WHERE id=?",
      )
      .run(invite.id);
    assert.equal((await f.accept(invite.token)).statusCode, 200);
    f.app.store.db
      .prepare(
        "UPDATE fairshare_agreement_invites SET accepted_by=NULL WHERE id=?",
      )
      .run(invite.id);
    const [row] = (
      await f.app.inject({
        url: `${f.url}/invitation-links`,
        headers: f.headers(),
      })
    ).json().invitations;
    assert.equal(row.status, "ACCEPTED");
    assert.equal(row.invitee, null);
    assert.equal(row.acceptedBy, undefined);
  } finally {
    await f.app.close();
  }
});
test("invitee columns are added idempotently to a pre-existing table", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dbPath = join(mkdtempSync(join(tmpdir(), "fs-invites-")), "db.sqlite");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`CREATE TABLE fairshare_agreement_invites(
    id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL,
    agreement_id TEXT NOT NULL, created_by TEXT NOT NULL, expires_at INTEGER NOT NULL,
    accepted_at INTEGER, revoked_at INTEGER);
    INSERT INTO fairshare_agreement_invites(id,hash,workspace_id,agreement_id,created_by,expires_at) VALUES('old','h','w','a','u',1);`);
  legacy.close();
  for (let i = 0; i < 2; i++) {
    const app = await buildApp({ dbPath });
    const columns = (
      app.store.db
        .prepare("PRAGMA table_info(fairshare_agreement_invites)")
        .all() as any[]
    ).map((c) => c.name);
    for (const c of [
      "invitee_name",
      "invitee_email",
      "invitee_role",
      "accepted_by",
    ])
      assert(columns.includes(c));
    assert.equal(
      (
        app.store.db
          .prepare(
            "SELECT invitee_email FROM fairshare_agreement_invites WHERE id='old'",
          )
          .get() as any
      ).invitee_email,
      null,
    );
    await app.close();
  }
});
