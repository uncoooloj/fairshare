import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    });
    const accounts = `/api/workspaces/${w.id}/payment-accounts?version=2`;
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
            url: `/api/workspaces/${workspace}/payment-accounts?version=2`,
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
    const path = `/api/workspaces/${w.id}/payment-accounts?version=2`;
    let result = (await app.inject({ url: path, headers })).json();
    assert.deepEqual(result.own, {
      type: "PAYPAL_ID",
      value: "ABCDEFGHIJKLM",
      updatedAt: null,
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

test("v1 payout compatibility keeps merchant IDs scoped and v2 email private", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fairshare-payout-compat-"));
  const app = await buildApp({ dbPath: join(directory, "db.sqlite") });
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
      .run(w.id, b.user.id, "MEMBER");
    const asA = { authorization: `Bearer ${a.token}` };
    const asB = { authorization: `Bearer ${b.token}` };
    const accounts = `/api/workspaces/${w.id}/payment-accounts`;
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });

    // v2 saves B's email, which is intentionally absent from the v1 response.
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/api/auth/payout-account",
          headers: asB,
          payload: { email: "b.paypal@example.test" },
        })
      ).statusCode,
      200,
    );
    const legacySave = await fetch(`${origin}${accounts}/mine`, {
      method: "PUT",
      headers: { ...asA, "content-type": "application/json" },
      body: JSON.stringify({ paypalId: "ABCDEFGHIJKLM" }),
    });
    assert.equal(legacySave.status, 200);
    assert.deepEqual(await legacySave.json(), { status: "SAVED_UNVERIFIED" });
    const legacy = await fetch(`${origin}${accounts}`, { headers: asA });
    assert.equal(legacy.status, 200);
    const legacyBody = (await legacy.json()) as any;
    assert.equal(legacyBody.ownPaypalId, "ABCDEFGHIJKLM");
    const legacyMembers = legacyBody.members
      .map((member: any) => ({
        id: member.id,
        status: member.status,
        accountHint: member.accountHint,
      }))
      .sort((left: any, right: any) => left.id.localeCompare(right.id));
    assert.deepEqual(
      legacyMembers,
      [
        {
          id: a.user.id,
          status: "SAVED_UNVERIFIED",
          accountHint: "•••• JKLM",
        },
        { id: b.user.id, status: "MISSING", accountHint: null },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
    assert(!JSON.stringify(legacyBody).includes("b.paypal@example.test"));

    const v2 = await fetch(`${origin}${accounts}?version=2`, { headers: asA });
    assert.equal(v2.status, 200);
    const v2Body = (await v2.json()) as any;
    assert.deepEqual(
      v2Body.members.map((member: any) => Object.keys(member).sort()),
      [
        ["id", "name", "status"],
        ["id", "name", "status"],
      ],
    );
    assert.equal(
      v2Body.members.find((member: any) => member.id === b.user.id).status,
      "READY",
    );
    assert(!JSON.stringify(v2Body).includes("b.paypal@example.test"));

    const collaboration = await app.inject({
      method: "POST",
      url: `/api/workspaces/${w.id}/collaborations`,
      headers: asA,
      payload: { name: "Compatibility" },
    });
    assert.equal(collaboration.statusCode, 201, collaboration.body);
    const recipient = await app.inject({
      method: "PUT",
      url: `/api/workspaces/${w.id}/collaborations/${collaboration.json().id}/recipient`,
      headers: asA,
      payload: { paypalId: "NOPQRSTUVWXYZ" },
    });
    assert.equal(recipient.statusCode, 200, recipient.body);
    assert.deepEqual(recipient.json(), { configured: true });
    assert.equal(
      (
        app.store.db
          .prepare(
            "SELECT paypal_id FROM fairshare_recipients WHERE workspace_id=? AND user_id=?",
          )
          .get(w.id, a.user.id) as any
      ).paypal_id,
      "NOPQRSTUVWXYZ",
    );
    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `${accounts}/mine`,
          headers: asA,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: accounts, headers: asA })).json().ownPaypalId,
      null,
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("activity includes accessible contract events but hides unrelated contracts; legacy writes still reject viewers", async () => {
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
    // The legacy route preserves its former owner/member authorization.
    for (const method of ["PUT", "DELETE"] as const)
      assert.equal(
        (
          await app.inject({
            url: `/api/workspaces/${w.id}/payment-accounts/mine`,
            method,
            headers: viewer,
            payload: { paypalId: "ABCDEFGHIJKLM" },
          })
        ).statusCode,
        403,
      );
  } finally {
    await app.close();
  }
});
