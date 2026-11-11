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
    const unauth = await app.inject({
      method: "POST",
      url: "/api/agreement-invitations/preview",
      payload: { token: invite.token },
    });
    assert.equal(unauth.statusCode, 401);
    const preview = await app.inject({
      method: "POST",
      url: "/api/agreement-invitations/preview",
      headers: f.headers(f.guest),
      payload: { token: invite.token },
    });
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.json().agreementName, "Private agreement");
    assert.equal(preview.json().rules, undefined);
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
    value.versions = [{ id: 1 }];
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
