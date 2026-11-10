import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { Role } from "../src/identity.js";
import {
  createResendTransport,
  configuredMailTransport,
  publicAppOrigin,
  MailKind,
  type MailMessage,
  type MailTransport,
} from "../src/mail.js";
const payload = {
  email: "owner@example.test",
  name: "Owner",
  password: "Correct-Horse-123",
};
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
async function reg(app: any, email = payload.email) {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { ...payload, email },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
const tokenFrom = (link: string) =>
  new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
const verify = (app: any, userId: string) => {
  const p = app.store.createEmailVerification(userId);
  app.store.confirmEmail(userId, p.token);
};
test("sandbox never exposes verification token and fails closed without email", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const u = await reg(app);
    assert.equal(u.user.emailVerified, false);
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/verification/request",
      headers: headers(u.token),
      payload: {},
    });
    assert.equal(r.statusCode, 503);
    assert(!r.body.includes("demoVerificationLink"));
    assert.equal(
      (
        app.store.db
          .prepare("SELECT COUNT(*) n FROM email_verifications")
          .get() as any
      ).n,
      0,
    );
    const w = app.store.createWorkspace(u.user.id, "Team");
    verify(app, u.user.id);
    const invite = await app.inject({
      method: "POST",
      url: `/api/workspaces/${w.id}/invitations`,
      headers: headers(u.token),
      payload: { email: "member@example.test", role: "MEMBER" },
    });
    assert.equal(invite.statusCode, 503);
    assert.equal(
      (app.store.db.prepare("SELECT COUNT(*) n FROM invitations").get() as any)
        .n,
      0,
    );
  } finally {
    await app.close();
  }
});
test("real adapter injection gets verification link; correct signed-in owner only, replay/expiry rejected", async () => {
  const messages: MailMessage[] = [];
  let now = 1000;
  const app = await buildApp({
    dbPath: ":memory:",
    clock: () => now,
    mailTransport: {
      async send(m) {
        messages.push(m);
        return { providerId: "test" };
      },
    },
    publicAppOrigin: "https://fairshare.example",
  });
  try {
    const a = await reg(app),
      b = await reg(app, "b@example.test");
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/verification/request",
      headers: headers(a.token),
      payload: {},
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().status, "EMAIL_REQUESTED");
    assert.equal(messages[0]!.to, a.user.email);
    const token = tokenFrom(messages[0]!.link);
    assert(!r.body.includes(token));
    const confirm = (t: string, who = a.token) =>
      app.inject({
        method: "POST",
        url: "/api/auth/verification/confirm",
        headers: headers(who),
        payload: { token: t },
      });
    assert.equal((await confirm(token, b.token)).statusCode, 400);
    assert.equal((await confirm(token)).json().user.emailVerified, true);
    assert.equal((await confirm(token)).statusCode, 400);
    const expired = app.store.createEmailVerification(b.user.id);
    now += 31 * 60000;
    assert.equal((await confirm(expired.token, b.token)).statusCode, 400);
  } finally {
    await app.close();
  }
});
test("sandbox email-bound invitations require independently verified recipient and do not expose token to inviter", async () => {
  const messages: MailMessage[] = [];
  const app = await buildApp({
    dbPath: ":memory:",
    mailTransport: {
      async send(m) {
        messages.push(m);
        return { providerId: "sent" };
      },
    },
  });
  try {
    const a = await reg(app),
      b = await reg(app, "b@example.test"),
      w = app.store.createWorkspace(a.user.id, "Team");
    const request = () =>
      app.inject({
        method: "POST",
        url: `/api/workspaces/${w.id}/invitations`,
        headers: headers(a.token),
        payload: { email: b.user.email, role: "MEMBER" },
      });
    assert.equal((await request()).statusCode, 403);
    verify(app, a.user.id);
    const r = await request();
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().invitation.token, undefined);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.to, b.user.email);
    const token = tokenFrom(messages[0]!.link);
    const accept = () =>
      app.inject({
        method: "POST",
        url: "/api/invitations/accept",
        headers: headers(b.token),
        payload: { token },
      });
    assert.equal((await accept()).statusCode, 403);
    verify(app, b.user.id);
    assert.equal((await accept()).statusCode, 200);
    assert.equal((await accept()).statusCode, 400);
  } finally {
    await app.close();
  }
});
test("failed mail revokes invitation and verification token; no provider body or secrets returned", async () => {
  const messages: MailMessage[] = [];
  const transport: MailTransport = {
    async send(m) {
      messages.push(m);
      throw new Error("SECRET_PROVIDER_BODY");
    },
  };
  const app = await buildApp({ dbPath: ":memory:", mailTransport: transport });
  try {
    const a = await reg(app);
    let r = await app.inject({
      method: "POST",
      url: "/api/auth/verification/request",
      headers: headers(a.token),
      payload: {},
    });
    assert.equal(r.statusCode, 503);
    assert(!r.body.includes("SECRET"));
    assert.throws(() =>
      app.store.confirmEmail(a.user.id, tokenFrom(messages[0]!.link)),
    );
    verify(app, a.user.id);
    const b = await reg(app, "b@example.test");
    verify(app, b.user.id);
    const w = app.store.createWorkspace(a.user.id, "Team");
    r = await app.inject({
      method: "POST",
      url: `/api/workspaces/${w.id}/invitations`,
      headers: headers(a.token),
      payload: { email: b.user.email, role: Role.MEMBER },
    });
    assert.equal(r.statusCode, 503);
    assert.throws(() => app.store.accept(b.user, tokenFrom(messages[1]!.link)));
  } finally {
    await app.close();
  }
});
test("DEMO explicitly simulates email verification and never calls real transport", async () => {
  const app = await buildApp({
    dbPath: ":memory:",
    demo: true,
    mailTransport: {
      async send() {
        throw new Error("must not call");
      },
    },
  });
  try {
    const a = await reg(app);
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/verification/request",
      headers: headers(a.token),
      payload: {},
    });
    assert.equal(r.json().status, "DEMO_ONLY");
    const c = await app.inject({
      method: "POST",
      url: "/api/auth/verification/confirm",
      headers: headers(a.token),
      payload: { token: tokenFrom(r.json().demoVerificationLink) },
    });
    assert.equal(c.json().verificationMode, "DEMO_SIMULATION");
    const w = app.store.createWorkspace(a.user.id, "Team");
    const i = await app.inject({
      method: "POST",
      url: `/api/workspaces/${w.id}/invitations`,
      headers: headers(a.token),
      payload: { email: "b@example.test", role: "VIEWER" },
    });
    assert.equal(i.json().delivery, "DEMO_ONLY");
    assert(i.json().demoInvitationLink);
  } finally {
    await app.close();
  }
});
test("Resend adapter is opt-in, validates origin and sanitizes errors", async () => {
  assert.equal(
    configuredMailTransport({ RESEND_API_KEY: "not-enabled" }),
    undefined,
  );
  assert.throws(() =>
    configuredMailTransport({ EMAIL_DELIVERY_ENABLED: "true" }),
  );
  for (const u of [
    "http://public.example",
    "https://user:pass@example.test",
    "https://example.test/path",
    "https://example.test/?x=1",
  ])
    assert.throws(() => publicAppOrigin(u));
  let request: any;
  const transport = createResendTransport({
    apiKey: "test-secret",
    from: "Fairshare <noreply@example.test>",
    fetch: async (url, opts) => {
      request = { url, opts };
      return new Response(JSON.stringify({ id: "mail123" }), { status: 200 });
    },
  });
  const result = await transport.send({
    kind: MailKind.VERIFY_EMAIL,
    to: "a@example.test",
    link: "https://example.test/verify-email#token=test",
    expiresAt: 1000,
    operationId: "operation1",
  });
  assert.equal(result.providerId, "mail123");
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.opts.headers["Idempotency-Key"], "operation1");
  assert.deepEqual(JSON.parse(request.opts.body).to, ["a@example.test"]);
  const bad = createResendTransport({
    apiKey: "test",
    from: "noreply@example.test",
    fetch: async () => new Response("private provider error", { status: 403 }),
  });
  await assert.rejects(
    () =>
      bad.send({
        kind: MailKind.VERIFY_EMAIL,
        to: "a@example.test",
        link: "https://example.test",
        expiresAt: 1000,
        operationId: "op",
      }),
    /^Error: EMAIL_PROVIDER_REJECTED$/,
  );
});
