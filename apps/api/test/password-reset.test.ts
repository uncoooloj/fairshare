import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { MailKind, type MailMessage } from "../src/mail.js";
const original = "Correct-Horse-123",
  next = "Different-Horse-123";
const request = (email: string) => ({
  method: "POST" as const,
  url: "/api/auth/password-reset/request",
  payload: { email },
});
function verified(app: any) {
  const user = app.store.register({
    name: "Maya",
    email: "maya@example.test",
    password: original,
  });
  const proof = app.store.createEmailVerification(user.user.id);
  app.store.confirmEmail(user.user.id, proof.token);
  return user;
}
test("reset uses hashed one-use email-bound credentials and revokes all sessions", async () => {
  const messages: MailMessage[] = [];
  const app = await buildApp({
    dbPath: ":memory:",
    publicAppOrigin: "https://fairshare.example",
    mailTransport: {
      async send(m) {
        messages.push(m);
        return { providerId: "test" };
      },
    },
  });
  try {
    const u = verified(app),
      second = app.store.login(u.user.email, original);
    const known = await app.inject(request(u.user.email)),
      unknown = await app.inject(request("unknown@example.test"));
    assert.equal(known.statusCode, 200, known.body);
    assert.deepEqual(known.json(), unknown.json());
    assert.equal(messages.length, 1);
    assert.equal(messages[0].kind, MailKind.RESET_PASSWORD);
    const token = new URLSearchParams(
      new URL(messages[0].link).hash.slice(1),
    ).get("token")!;
    assert(!known.body.includes(token));
    assert(
      !JSON.stringify(
        app.store.db.prepare("SELECT * FROM password_resets").all(),
      ).includes(token),
    );
    const payload = { token, password: next };
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      payload,
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.throws(() => app.store.userForToken(u.token));
    assert.throws(() => app.store.userForToken(second.token));
    assert.throws(() => app.store.login(u.user.email, original));
    assert(app.store.login(u.user.email, next).token);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/password-reset/confirm",
          payload,
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});
test("expiry, replacement, password change and email mismatch invalidate reset credentials", async () => {
  let now = 1000;
  const app = await buildApp({ dbPath: ":memory:", clock: () => now });
  try {
    const u = verified(app);
    const old = app.store.createPasswordReset(u.user.email)!;
    const fresh = app.store.createPasswordReset(u.user.email)!;
    assert.throws(() => app.store.resetPassword(old.token, next));
    now += 15 * 60000;
    assert.throws(() => app.store.resetPassword(fresh.token, next));
    const changed = app.store.createPasswordReset(u.user.email)!;
    app.store.changePassword(u.user.id, original, next);
    assert.throws(() => app.store.resetPassword(changed.token, original));
    const mismatch = app.store.createPasswordReset(u.user.email)!;
    app.store.db
      .prepare("UPDATE users SET email=? WHERE id=?")
      .run("new@example.test", u.user.id);
    assert.throws(() => app.store.resetPassword(mismatch.token, original));
  } finally {
    await app.close();
  }
});
test("unverified accounts cannot reset; delivery failures never expose account existence or leave usable tokens", async () => {
  const app = await buildApp({
    dbPath: ":memory:",
    publicAppOrigin: "https://fairshare.example",
    mailTransport: {
      async send() {
        throw new Error("private-provider-detail");
      },
    },
  });
  try {
    const u = verified(app);
    app.store.register({
      name: "Unverified",
      email: "unverified@example.test",
      password: original,
    });
    assert.equal(
      app.store.createPasswordReset("unverified@example.test"),
      null,
    );
    const known = await app.inject(request(u.user.email)),
      missing = await app.inject(request("missing@example.test"));
    assert.deepEqual(known.json(), missing.json());
    assert(!known.body.includes("private-provider"));
    assert.equal(
      (
        app.store.db
          .prepare("SELECT count(*) AS n FROM password_resets")
          .get() as any
      ).n,
      0,
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await app.inject(request("missing@example.test"))).statusCode,
        200,
      );
    assert.equal(
      (await app.inject(request("missing@example.test"))).statusCode,
      429,
    );
  } finally {
    await app.close();
  }
});
test("disabled email fails truthfully for every address without generating tokens", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const u = verified(app);
    assert.equal((await app.inject(request(u.user.email))).statusCode, 503);
    assert.equal(
      (await app.inject(request("missing@example.test"))).statusCode,
      503,
    );
    assert.equal(
      (
        app.store.db
          .prepare("SELECT count(*) AS n FROM password_resets")
          .get() as any
      ).n,
      0,
    );
  } finally {
    await app.close();
  }
});
