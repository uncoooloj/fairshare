import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
test("profile updates are session-bound, durable, name-only, and audited", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const a = app.store.register({
      name: "Before",
      email: "a@example.test",
      password: "Correct-Horse-123",
    });
    const b = app.store.register({
      name: "Other",
      email: "b@example.test",
      password: "Correct-Horse-123",
    });
    const headers = { authorization: `Bearer ${a.token}` };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/profile",
          payload: { name: "No auth" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/profile",
          headers,
          payload: {
            name: "  Updated  ",
            userId: b.user.id,
            email: "hijack@example.test",
          },
        })
      ).statusCode,
      400,
    );
    const result = await app.inject({
      method: "POST",
      url: "/api/auth/profile",
      headers,
      payload: { name: "  Updated  " },
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().user.name, "Updated");
    assert.equal(result.json().user.email, a.user.email);
    assert.equal(app.store.userForToken(a.token).name, "Updated");
    assert.equal(app.store.userForToken(b.token).name, "Other");
    assert(!result.body.includes("password_hash"));
    assert.equal(
      (
        app.store.db
          .prepare(
            "SELECT count(*) AS n FROM audit WHERE action='PROFILE_UPDATED'",
          )
          .get() as any
      ).n,
      1,
    );
  } finally {
    await app.close();
  }
});
test("profile rejects empty, oversized and control-character names without changes", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const a = app.store.register({
      name: "Before",
      email: "a@example.test",
      password: "Correct-Horse-123",
    });
    for (const name of ["", "   ", "a".repeat(81), "Name\nSpoof"]) {
      const result = await app.inject({
        method: "POST",
        url: "/api/auth/profile",
        headers: { authorization: `Bearer ${a.token}` },
        payload: { name },
      });
      assert.equal(result.statusCode, 400, result.body);
    }
    assert.equal(app.store.userForToken(a.token).name, "Before");
  } finally {
    await app.close();
  }
});
