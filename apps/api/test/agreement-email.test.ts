import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp, type AppOptions } from "../src/app.js";
import {
  createResendTransport,
  renderMessage,
  MailKind,
  configuredMailTransport,
  type MailMessage,
} from "../src/mail.js";

async function fixture(options: AppOptions = {}) {
  let now = Date.now();
  const messages: MailMessage[] = [];
  const app = await buildApp({
    dbPath: ":memory:",
    clock: () => now,
    publicAppOrigin: "https://fairshare.example",
    mailTransport: {
      async send(m) {
        messages.push(m);
        return { providerId: "accepted-fixture" };
      },
    },
    ...options,
  });
  const register = (email: string) =>
    app.store.register({
      email,
      name: email.split("@")[0]!,
      password: "Correct-Horse-123",
    });
  const owner = register("owner@example.test"),
    peer = register("peer@example.test"),
    other = register("other@example.test");
  const proof = app.store.createEmailVerification(owner.user.id);
  app.store.confirmEmail(owner.user.id, proof.token);
  const workspace = app.store.createWorkspace(owner.user.id, "Team");
  const headers = (who = owner) => ({ authorization: `Bearer ${who.token}` });
  const agreement = (
    await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspace.id}/collaborations`,
      headers: headers(),
      payload: { name: "Midnight" },
    })
  ).json();
  const base = `/api/workspaces/${workspace.id}/collaborations/${agreement.id}`;
  const person = (
    await app.inject({
      method: "POST",
      url: `${base}/people`,
      headers: headers(),
      payload: {
        expectedRevision: agreement.revision,
        name: "Peer",
        email: peer.user.email,
      },
    })
  ).json();
  const seat = person.agreement.value.members.find((m: any) => m.pending);
  const send = (
    who = owner,
    token = person.invitation.token,
    id = seat.userId,
  ) =>
    app.inject({
      method: "POST",
      url: `${base}/people/${encodeURIComponent(id)}/invitation-email`,
      headers: headers(who),
      payload: { token },
    });
  const accept = (who = peer) =>
    app.inject({
      method: "POST",
      url: "/api/agreement-invitations/accept",
      headers: headers(who),
      payload: { token: person.invitation.token },
    });
  return {
    app,
    owner,
    peer,
    other,
    person,
    messages,
    send,
    accept,
    base,
    headers,
    advance: () => {
      now += 49 * 3600000;
    },
  };
}

test("named invitation email targets only the stored recipient; duplicate requests send once and preserve rules", async () => {
  const f = await fixture();
  try {
    const response = await f.send();
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().status, "PROVIDER_ACCEPTED");
    const m = f.messages[0]!;
    assert.equal(m.kind, MailKind.AGREEMENT_INVITATION);
    assert.equal(m.to, f.peer.user.email);
    assert.equal(
      new URLSearchParams(new URL(m.link).hash.slice(1)).get("token"),
      `agreement:${f.person.invitation.token}`,
    );
    assert.equal(new URL(m.link).pathname, "/invitation");
    assert.equal((await f.send()).json().repeated, true);
    assert.equal(f.messages.length, 1);
    assert(!response.body.includes(f.person.invitation.token));
    assert(
      !JSON.stringify(
        f.app.store.db
          .prepare("SELECT * FROM agreement_invitation_email")
          .all(),
      ).includes(f.person.invitation.token),
    );
    const wrong = await f.accept(f.other);
    assert.equal(wrong.statusCode, 403);
    assert.equal(wrong.json().error.code, "INVITATION_EMAIL_MISMATCH");
    const accepted = await f.accept();
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().agreement.value.versions.length, 0);
    assert.equal(f.app.store.userForToken(f.peer.token).emailVerified, false);
  } finally {
    await f.app.close();
  }
});

test("email requires configured non-DEMO transport, verified organizer, valid token and authorization", async () => {
  for (const options of [{ mailTransport: undefined }, { demo: true }]) {
    const f = await fixture(options);
    try {
      assert.equal((await f.send()).statusCode, 503);
      assert.equal(f.messages.length, 0);
    } finally {
      await f.app.close();
    }
  }
  const f = await fixture();
  try {
    assert.equal((await f.send(f.other)).statusCode, 404);
    assert.equal((await f.send(f.owner, "x".repeat(43))).statusCode, 400);
    assert.equal(
      (await f.send(f.owner, f.person.invitation.token, f.owner.user.id))
        .statusCode,
      409,
    );
    f.app.store.db
      .prepare("UPDATE users SET email_verified_at=NULL WHERE id=?")
      .run(f.owner.user.id);
    assert.equal((await f.send()).statusCode, 403);
    assert.equal(f.messages.length, 0);
  } finally {
    await f.app.close();
  }
});

test("unconfirmed send is durable, sanitized and never retried; manually shared links remain valid", async () => {
  let calls = 0;
  const f = await fixture({
    mailTransport: {
      async send() {
        calls++;
        throw new Error("private-provider-key-token");
      },
    },
  });
  try {
    const r = await f.send();
    assert.equal(r.statusCode, 503);
    assert(!r.body.includes("private-provider"));
    assert.equal((await f.send()).json().status, "UNCONFIRMED");
    assert.equal(calls, 1);
    assert.equal((await f.accept()).statusCode, 200);
  } finally {
    await f.app.close();
  }
});

test("concurrent duplicate presses and interrupted sends cannot send a second email", async () => {
  let release!: () => void,
    calls = 0;
  const f = await fixture({
    mailTransport: {
      async send() {
        calls++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { providerId: "once" };
      },
    },
  });
  try {
    const first = f.send();
    while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await f.send()).json().status, "SENDING");
    release();
    await first;
    assert.equal(calls, 1);
  } finally {
    await f.app.close();
  }
});

test("expired and revoked links, recipient opt-out and extra recipient input never reach the transport", async () => {
  const f = await fixture();
  try {
    const extra = await f.app.inject({
      method: "POST",
      url: `${f.base}/people/${encodeURIComponent(f.person.agreement.value.members.find((m: any) => m.pending).userId)}/invitation-email`,
      headers: f.headers(),
      payload: {
        token: f.person.invitation.token,
        to: "attacker@example.test",
      },
    });
    assert.equal(extra.statusCode, 400);
    const prefs = (
      await f.app.inject({
        url: "/api/auth/preferences",
        headers: f.headers(f.peer),
      })
    ).json().preferences;
    prefs.notifications.approvalRequests.email = false;
    await f.app.inject({
      method: "PUT",
      url: "/api/auth/preferences",
      headers: f.headers(f.peer),
      payload: prefs,
    });
    assert.equal((await f.send()).statusCode, 409);
    f.advance();
    assert.equal((await f.send()).statusCode, 400);
    assert.equal(f.messages.length, 0);
  } finally {
    await f.app.close();
  }
});

test("Resend invitation uses HTML and text, escapes supplied names and does not leak credentials on redirect/rejection", async () => {
  const m: MailMessage = {
    kind: MailKind.AGREEMENT_INVITATION,
    to: "peer@example.test",
    link: "https://fairshare.example/invitation#token=agreement%3Afixture",
    expiresAt: Date.now() + 1000,
    operationId: "invite-fixture",
    inviterName: '<img src=x onerror="alert(1)">',
    agreementName: "A & B",
  };
  const rendered = renderMessage(m);
  assert(!rendered.html.includes("<img"));
  assert(rendered.html.includes("&lt;img"));
  assert(rendered.html.includes("A &amp; B"));
  assert(rendered.text.includes(m.link));
  for (const kind of Object.values(MailKind)) {
    const r = renderMessage({ ...m, kind });
    assert(r.text.includes(m.link));
    assert(r.html.includes('href="' + m.link + '"'));
  }
  let payload: any,
    requests = 0;
  const transport = createResendTransport({
    apiKey: "fixture",
    from: "Fairshare <mail@example.test>",
    appOrigin: "https://fairshare.example",
    fetch: async (_url, options) => {
      requests++;
      payload = JSON.parse(options!.body as string);
      assert.equal(options!.redirect, "manual");
      return Response.json({ id: "accepted" });
    },
  });
  await transport.send(m);
  assert.deepEqual(payload.to, [m.to]);
  assert(payload.html);
  assert(payload.text);
  await assert.rejects(
    () => transport.send({ ...m, link: "https://other.example/invitation" }),
    /EMAIL_MESSAGE_INVALID/,
  );
  await assert.rejects(
    () => transport.send({ ...m, to: "a@example.test\r\nBcc: b@example.test" }),
    /EMAIL_MESSAGE_INVALID/,
  );
  assert.equal(requests, 1);
  assert.equal(
    configuredMailTransport({
      DEMO_MODE: "true",
      EMAIL_DELIVERY_ENABLED: "true",
    }),
    undefined,
  );
  assert.throws(() =>
    createResendTransport({ apiKey: "fixture", from: "not-an-address" }),
  );
});

test("revoked invitation and departed original creator cannot be emailed", async () => {
  for (const action of ["revoke", "creator-left"]) {
    const f = await fixture();
    try {
      if (action === "revoke")
        f.app.store.db
          .prepare(
            "UPDATE fairshare_agreement_invites SET revoked_at=? WHERE id=?",
          )
          .run(Date.now(), f.person.invitation.id);
      else
        // Same invalid state as a named link whose original creator left after handover.
        f.app.store.db
          .prepare(
            "UPDATE fairshare_agreement_invites SET created_by=? WHERE id=?",
          )
          .run(f.other.user.id, f.person.invitation.id);
      assert.equal((await f.send()).statusCode, 400);
      assert.equal(f.messages.length, 0);
      assert.equal(
        (
          f.app.store.db
            .prepare("SELECT COUNT(*) n FROM agreement_invitation_email")
            .get() as any
        ).n,
        0,
      );
    } finally {
      await f.app.close();
    }
  }
});

test("persisted SENDING and UNCONFIRMED reservations suppress provider calls after reopening the database", async () => {
  for (const state of ["SENDING", "UNCONFIRMED"]) {
    const directory = mkdtempSync(join(tmpdir(), "fairshare-email-"));
    const dbPath = join(directory, "mail.sqlite");
    const f = await fixture({ dbPath });
    f.app.store.db
      .prepare(
        "INSERT INTO agreement_invitation_email(invitation_id,status,created_at) VALUES(?,?,?)",
      )
      .run(f.person.invitation.id, state, Date.now());
    await f.app.close();
    let calls = 0;
    const reopened = await buildApp({
      dbPath,
      publicAppOrigin: "https://fairshare.example",
      mailTransport: {
        async send() {
          calls++;
          return { providerId: "must-not-send" };
        },
      },
    });
    try {
      const seat = f.person.agreement.value.members.find((m: any) => m.pending);
      const response = await reopened.inject({
        method: "POST",
        url: `${f.base}/people/${encodeURIComponent(seat.userId)}/invitation-email`,
        headers: f.headers(),
        payload: { token: f.person.invitation.token },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().status, state);
      assert.equal(response.json().repeated, true);
      assert.equal(calls, 0);
    } finally {
      await reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
