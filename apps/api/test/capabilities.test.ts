import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
test("email delivery is unavailable by default while private link sharing remains available", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const result = await app.inject({
      method: "GET",
      url: "/api/auth/capabilities",
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json(), {
      emailDelivery: false,
      invitationDelivery: "LINK",
    });
    assert.equal(result.headers["cache-control"], "no-store");
  } finally {
    await app.close();
  }
});
test("email capability only advertises configured server transport", async () => {
  const app = await buildApp({
    dbPath: ":memory:",
    publicAppOrigin: "https://app.example.test",
    mailTransport: {
      async send() {
        return { providerId: "test" };
      },
    },
  });
  try {
    assert.equal(
      (
        await app.inject({ method: "GET", url: "/api/auth/capabilities" })
      ).json().emailDelivery,
      true,
    );
  } finally {
    await app.close();
  }
});
test("DEMO never advertises real email even with a configured transport", async () => {
  const app = await buildApp({
    dbPath: ":memory:",
    demo: true,
    mailTransport: {
      async send() {
        throw new Error("must not send");
      },
    },
  });
  try {
    assert.equal(
      (
        await app.inject({ method: "GET", url: "/api/auth/capabilities" })
      ).json().emailDelivery,
      false,
    );
  } finally {
    await app.close();
  }
});
