import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";

async function setup() {
  const app = await buildApp({ dbPath: ":memory:" });
  const owner = app.store.register({
    name: "Maya",
    email: "maya@example.com",
    password: "Password123!",
  });
  const headers = { authorization: `Bearer ${owner.token}` };
  const intake = (payload: object) =>
    app.inject({
      method: "POST",
      url: "/api/agreements/intake",
      headers,
      payload,
    });
  const details = (
    base: string,
    payload: object,
    auth: Record<string, string> = headers,
  ) =>
    app.inject({
      method: "POST",
      url: base + "/details",
      headers: auth,
      payload,
    });
  const count = (table: string) =>
    Number(
      (app.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as any)
        .n,
    );
  return { app, owner, headers, intake, details, count };
}

test("intake applies name and details atomically and replays idempotently", async () => {
  const { app, intake, count } = await setup();
  try {
    const payload = {
      requestId: randomUUID(),
      text: "Maya receives half of net revenue.",
      filename: "ignored-name.pdf",
      name: "  Studio royalties ",
      currency: "USD",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    };
    const first = await intake(payload);
    assert.equal(first.statusCode, 201, first.body);
    const result = first.json();
    assert.equal(result.agreement.value.name, "Studio royalties");
    assert.deepEqual(result.agreement.value.details, {
      currency: "USD",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
    const replay = await intake(payload);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), result);
    assert.equal(count("fairshare_collaborations"), 1);
    for (const changed of [
      { effectiveTo: "2026-12-31" },
      { effectiveFrom: "2026-01-02" },
      { name: "Other name" },
      { effectiveTo: undefined },
    ]) {
      const response = await intake({ ...payload, ...changed });
      assert.equal(response.statusCode, 409, JSON.stringify(changed));
      assert.equal(response.json().error.code, "IDEMPOTENCY_CONFLICT");
    }
    assert.equal(count("fairshare_collaborations"), 1);
  } finally {
    await app.close();
  }
});

test("intake rejects invalid dates, reversed ranges and unsupported currencies", async () => {
  const { app, intake, count } = await setup();
  try {
    const cases: Array<[object, string]> = [
      [{ effectiveFrom: "2026-02-30" }, "INVALID_DATE"],
      [{ effectiveFrom: "01/02/2026" }, "INVALID_DATE"],
      [{ effectiveTo: "2026-1-5" }, "INVALID_DATE"],
      [
        { effectiveFrom: "2026-03-01", effectiveTo: "2026-02-28" },
        "INVALID_DATE_RANGE",
      ],
      [{ currency: "EUR" }, "INVALID_CURRENCY"],
      [{ currency: null }, "INVALID_CURRENCY"],
      [{ name: "" }, "INVALID_INPUT"],
      [{ name: "a".repeat(201) }, "INVALID_INPUT"],
    ];
    for (const [fields, code] of cases) {
      const response = await intake({
        requestId: randomUUID(),
        text: "Contract text",
        ...fields,
      });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().error.code, code, JSON.stringify(fields));
    }
    assert.equal(count("workspaces"), 0);
  } finally {
    await app.close();
  }
});

test("details route updates with revision checks, audit and organizer-only access", async () => {
  const { app, intake, details } = await setup();
  try {
    const created = (
      await intake({ requestId: randomUUID(), text: "Contract text" })
    ).json();
    const workspaceId = created.workspace.id;
    const agreementId = created.agreement.id;
    const base = `/api/workspaces/${workspaceId}/collaborations/${agreementId}`;
    // Legacy-shaped agreement: no details stored, reads as USD.
    assert.equal(created.agreement.value.details, undefined);
    const updated = await details(base, {
      expectedRevision: 1,
      name: "Renamed",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().revision, 2);
    assert.equal(updated.json().value.name, "Renamed");
    assert.deepEqual(updated.json().value.details, {
      currency: "USD",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
    });
    const stale = await details(base, {
      expectedRevision: 1,
      effectiveTo: null,
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error.code, "REVISION_CONFLICT");
    const reversed = await details(base, {
      expectedRevision: 2,
      effectiveTo: "2025-12-31",
    });
    assert.equal(reversed.statusCode, 400);
    assert.equal(reversed.json().error.code, "INVALID_DATE_RANGE");
    for (const payload of [
      { expectedRevision: 2 },
      { expectedRevision: 2, currency: "NGN" },
      { expectedRevision: 2, effectiveFrom: null },
      { expectedRevision: 2, other: 1 },
      { effectiveTo: null },
    ])
      assert.equal(
        (await details(base, payload)).statusCode,
        400,
        JSON.stringify(payload),
      );
    const audit = app.store.db
      .prepare("SELECT action,detail FROM audit WHERE action=?")
      .all("AGREEMENT_DETAILS_UPDATED") as { detail: string }[];
    assert.equal(audit.length, 1);
    assert.deepEqual(JSON.parse(audit[0].detail), {
      agreementId,
      fields: ["name", "effectiveFrom", "effectiveTo"],
    });

    const peer = app.store.register({
      name: "Ade",
      email: "ade@example.com",
      password: "Password123!",
    });
    app.store.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(workspaceId, peer.user.id, "MEMBER");
    const row = app.store.db
      .prepare(
        "SELECT value FROM fairshare_collaborations WHERE workspace_id=? AND id=?",
      )
      .get(workspaceId, agreementId) as { value: string };
    const value = JSON.parse(row.value);
    value.members.push({
      userId: peer.user.id,
      displayName: "Ade",
      role: "COLLABORATOR",
    });
    app.store.db
      .prepare(
        "UPDATE fairshare_collaborations SET value=? WHERE workspace_id=? AND id=?",
      )
      .run(JSON.stringify(value), workspaceId, agreementId);
    const forbidden = await details(
      base,
      { expectedRevision: 2, effectiveTo: null },
      { authorization: `Bearer ${peer.token}` },
    );
    assert.equal(forbidden.statusCode, 403);
    assert.equal(
      (
        app.store.db
          .prepare("SELECT revision FROM fairshare_collaborations WHERE id=?")
          .get(agreementId) as { revision: number }
      ).revision,
      2,
    );
  } finally {
    await app.close();
  }
});

test("legacy agreements without details keep working and gain details on edit", async () => {
  const { app, intake, details, headers } = await setup();
  try {
    const legacyPayload = { requestId: randomUUID(), text: "Legacy contract" };
    const created = await intake(legacyPayload);
    assert.equal(created.statusCode, 201);
    const { workspace, agreement } = created.json();
    assert.equal("details" in agreement.value, false);
    // Replay of a pre-details body keeps the same fingerprint.
    assert.equal((await intake(legacyPayload)).statusCode, 200);
    const base = `/api/workspaces/${workspace.id}/collaborations/${agreement.id}`;
    const renamed = await app.inject({
      method: "POST",
      url: base + "/name",
      headers,
      payload: { name: "Still works", expectedRevision: 1 },
    });
    assert.equal(renamed.statusCode, 200, renamed.body);
    const listed = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspace.id}/collaborations`,
      headers,
    });
    assert.equal(listed.statusCode, 200, listed.body);
    const updated = await details(base, {
      expectedRevision: 2,
      effectiveFrom: "2026-05-01",
    });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.deepEqual(updated.json().value.details, {
      currency: "USD",
      effectiveFrom: "2026-05-01",
    });
  } finally {
    await app.close();
  }
});
