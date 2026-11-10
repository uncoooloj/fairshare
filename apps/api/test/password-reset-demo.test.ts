import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
test("DEMO never sends password resets even when transport is configured", async () => {
  let sent = 0;
  const app = await buildApp({
    dbPath: ":memory:",
    demo: true,
    mailTransport: {
      async send() {
        sent++;
        return { providerId: "unexpected" };
      },
    },
  });
  try {
    const u = app.store.register({
      name: "Demo",
      email: "demo@example.test",
      password: "Correct-Horse-123",
    });
    const proof = app.store.createEmailVerification(u.user.id);
    app.store.confirmEmail(u.user.id, proof.token);
    const result = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: { email: u.user.email },
    });
    assert.equal(result.statusCode, 503);
    assert.equal(sent, 0);
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
