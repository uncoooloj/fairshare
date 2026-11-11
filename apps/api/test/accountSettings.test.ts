import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

test("payout email: one per person, validated and lowercased, suggestion never saved, organizer sees readiness only", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const a = app.store.register({
      name: "A",
      email: "Organizer@Example.test",
      password: "Correct-Horse-123",
    });
    const b = app.store.register({
      name: "B",
      email: "b@example.test",
      password: "Correct-Horse-123",
    });
    const w = app.store.createWorkspace(a.user.id, "Studio");
    const w2 = app.store.createWorkspace(b.user.id, "Other");
    app.store.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(w.id, b.user.id, "MEMBER");
    const own = "/api/auth/payout-account";
    const asA = { authorization: `Bearer ${a.token}` },
      asB = { authorization: `Bearer ${b.token}` };
    assert.equal((await app.inject({ url: own })).statusCode, 401);
    // Suggestion is shown, not saved.
    assert.deepEqual((await app.inject({ url: own, headers: asB })).json(), {
      destination: null,
      suggestedEmail: "b@example.test",
      paypalConnect: false,
    });
    const accounts = `/api/workspaces/${w.id}/payment-accounts`;
    let list = (await app.inject({ url: accounts, headers: asA })).json();
    assert.deepEqual(
      list.members.map((m: any) => m.status),
      ["NEEDS_EMAIL", "NEEDS_EMAIL"],
    );
    for (const email of ["not-an-email", "", 42, `${"x".repeat(120)}@ex.test`])
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: own,
            headers: asB,
            payload: { email },
          })
        ).statusCode,
        400,
      );
    const saved = await app.inject({
      method: "PUT",
      url: own,
      headers: asB,
      payload: { email: "  B.PayPal@Example.TEST ", userId: a.user.id },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().destination.type, "EMAIL");
    assert.equal(saved.json().destination.value, "b.paypal@example.test");
    // Only the caller's row is written, even if another userId is supplied.
    assert.equal(
      (await app.inject({ url: own, headers: asA })).json().destination,
      null,
    );
    // Account-level: the same email applies in every workspace.
    for (const workspace of [w.id, w2.id])
      assert.equal(
        (
          await app.inject({
            url: `/api/workspaces/${workspace}/payment-accounts`,
            headers: asB,
          })
        ).json().own.value,
        "b.paypal@example.test",
      );
    // Organizer sees readiness, never the address or a hint of it.
    const organizerView = await app.inject({ url: accounts, headers: asA });
    list = organizerView.json();
    assert.equal(
      list.members.find((m: any) => m.id === b.user.id).status,
      "READY",
    );
    assert.deepEqual(Object.keys(list.members[0]).sort(), [
      "id",
      "name",
      "status",
    ]);
    assert.equal(list.own, null);
    assert(!organizerView.body.toLowerCase().includes("paypal@example"));
    assert.equal(
      (await app.inject({ method: "DELETE", url: own, headers: asB }))
        .statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: own, headers: asB })).json().destination,
      null,
    );
  } finally {
    await app.close();
  }
});

test("legacy per-workspace PayPal ID is read as a fallback without rewriting it", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const a = app.store.register({
      name: "A",
      email: "a@example.test",
      password: "Correct-Horse-123",
    });
    const w = app.store.createWorkspace(a.user.id, "Studio");
    const headers = { authorization: `Bearer ${a.token}` };
    app.store.db
      .prepare("INSERT INTO fairshare_recipients VALUES(?,?,?)")
      .run(w.id, a.user.id, "ABCDEFGHIJKLM");
    const path = `/api/workspaces/${w.id}/payment-accounts`;
    let result = (await app.inject({ url: path, headers })).json();
    assert.deepEqual(result.own, {
      type: "PAYPAL_ID",
      value: "ABCDEFGHIJKLM",
      updatedAt: null,
      verified: false,
      verifiedAt: null,
    });
    assert.equal(result.members[0].status, "READY");
    await app.inject({
      method: "PUT",
      url: "/api/auth/payout-account",
      headers,
      payload: { email: "a@example.test" },
    });
    result = (await app.inject({ url: path, headers })).json();
    assert.equal(result.own.type, "EMAIL");
    // The legacy row is untouched; the new account-level email just wins.
    assert.equal(
      (
        app.store.db
          .prepare("SELECT paypal_id FROM fairshare_recipients WHERE user_id=?")
          .get(a.user.id) as any
      ).paypal_id,
      "ABCDEFGHIJKLM",
    );
  } finally {
    await app.close();
  }
});

test("activity filters, pagination and authorization keep account events private", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const a = app.store.register({
      name: "A",
      email: "a@example.test",
      password: "Correct-Horse-123",
    });
    const b = app.store.register({
      name: "B",
      email: "b@example.test",
      password: "Correct-Horse-123",
    });
    const w = app.store.createWorkspace(a.user.id, "Studio");
    const headers = { authorization: `Bearer ${a.token}` };
    for (let i = 0; i < 55; i++) app.store.audit(a.user.id, w.id, "TEST_EVENT");
    app.store.audit(b.user.id, null, "PRIVATE_EVENT");
    const path = `/api/settings/activity?workspaceId=${w.id}&action=TEST_EVENT`;
    const first = (await app.inject({ url: path, headers })).json();
    assert.equal(first.events.length, 50);
    assert.equal(first.total, 55);
    assert.equal(first.nextOffset, 50);
    assert.equal(
      (await app.inject({ url: `${path}&offset=50`, headers })).json().events
        .length,
      5,
    );
    assert(
      !(
        await app.inject({ url: "/api/settings/activity", headers })
      ).body.includes("PRIVATE_EVENT"),
    );
    assert.equal(
      (
        await app.inject({
          url: path,
          headers: { authorization: `Bearer ${b.token}` },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await app.inject({ url: "/api/settings/activity?days=-1", headers }))
        .statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ url: "/api/settings/activity?offset=1.2", headers }))
        .statusCode,
      400,
    );
    assert.equal((await app.inject({ url: path })).statusCode, 401);
  } finally {
    await app.close();
  }
});

test("activity includes accessible contract events but hides unrelated contracts; no workspace-scoped payout writes", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const a = app.store.register({
      name: "A",
      email: "a@example.test",
      password: "Correct-Horse-123",
    });
    const b = app.store.register({
      name: "B",
      email: "b@example.test",
      password: "Correct-Horse-123",
    });
    const w = app.store.createWorkspace(a.user.id, "Studio");
    app.store.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(w.id, b.user.id, "VIEWER");
    const headers = { authorization: `Bearer ${a.token}` },
      viewer = { authorization: `Bearer ${b.token}` };
    const made = await app.inject({
      method: "POST",
      url: `/api/workspaces/${w.id}/collaborations`,
      headers,
      payload: { name: "Private agreement" },
    });
    assert.equal(made.statusCode, 201, made.body);
    const path = `/api/settings/activity?workspaceId=${w.id}&agreementId=${made.json().id}`;
    assert.equal(
      (await app.inject({ url: path, headers })).json().events[0].action,
      "CREATED",
    );
    assert.equal(
      (await app.inject({ url: path, headers: viewer })).json().events.length,
      0,
    );
    // Destinations are account-level; there is no workspace-scoped write route.
    for (const method of ["PUT", "DELETE"] as const)
      assert.equal(
        (
          await app.inject({
            url: `/api/workspaces/${w.id}/payment-accounts/mine`,
            method,
            headers: viewer,
            payload: { email: "b@example.test" },
          })
        ).statusCode,
        404,
      );
  } finally {
    await app.close();
  }
});
