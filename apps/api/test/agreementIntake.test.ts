import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { buildApp } from "../src/app.js";

async function setup() {
  const app = await buildApp({ dbPath: ":memory:" });
  const owner = app.store.register({
    name: "Maya",
    email: "maya@example.com",
    password: "Password123!",
  });
  const headers = { authorization: `Bearer ${owner.token}` };
  const intake = (payload: object, auth = headers) =>
    app.inject({
      method: "POST",
      url: "/api/agreements/intake",
      headers: auth,
      payload,
    });
  const count = (table: string) =>
    Number(
      (app.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as any)
        .n,
    );
  return { app, owner, headers, intake, count };
}

test("upload-first text creates one atomic aggregate and retry returns the same IDs", async () => {
  const { app, intake, count, headers } = await setup();
  try {
    const payload = {
      requestId: randomUUID(),
      text: "Maya receives half of net revenue.",
    };
    const first = await intake(payload);
    assert.equal(first.statusCode, 201, first.body);
    const result = first.json();
    assert.equal(result.workspace.role, "OWNER");
    assert.equal(result.agreement.value.name, "Untitled agreement");
    assert.equal(result.document.text, payload.text);
    const replay = await intake(payload);
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), result);
    for (const table of [
      "workspaces",
      "memberships",
      "fairshare_collaborations",
      "fairshare_documents",
      "agreement_intakes",
    ])
      assert.equal(count(table), 1);
    assert.equal(
      (await intake({ ...payload, text: "Changed source" })).statusCode,
      409,
    );
    const base = `/api/workspaces/${result.workspace.id}/collaborations/${result.agreement.id}`;
    const renamed = await app.inject({
      method: "POST",
      url: base + "/name",
      headers,
      payload: { name: "Studio royalties", expectedRevision: 1 },
    });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal(renamed.json().value.name, "Studio royalties");
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: base + "/name",
          headers,
          payload: { name: "Stale", expectedRevision: 1 },
        })
      ).statusCode,
      409,
    );
    const workspaceRename = await app.inject({
      method: "POST",
      url: `/api/workspaces/${result.workspace.id}/name`,
      headers,
      payload: { name: "Studio" },
    });
    assert.equal(workspaceRename.json().workspace.name, "Studio");
  } finally {
    await app.close();
  }
});

test("invalid source creates no workspace; document insert failure rolls back everything", async () => {
  const { app, intake, count } = await setup();
  try {
    for (const payload of [
      { text: "" },
      { text: "a".repeat(40001) },
      { base64: "bad", mimeType: "application/pdf" },
      { text: "valid", base64: "also a file" },
      { text: "valid", useLocalOcr: true },
    ]) {
      const response = await intake({ requestId: randomUUID(), ...payload });
      assert.equal(response.statusCode, 400, response.body);
    }
    assert.equal(count("workspaces"), 0);
    app.store.db.exec(
      `CREATE TRIGGER reject_intake BEFORE INSERT ON fairshare_documents BEGIN SELECT RAISE(ABORT, 'test failure'); END`,
    );
    const payload = { requestId: randomUUID(), text: "Valid contract" };
    assert.equal((await intake(payload)).statusCode, 500);
    for (const table of [
      "workspaces",
      "memberships",
      "fairshare_collaborations",
      "fairshare_documents",
      "agreement_intakes",
    ])
      assert.equal(count(table), 0);
    app.store.db.exec("DROP TRIGGER reject_intake");
    assert.equal((await intake(payload)).statusCode, 201);
  } finally {
    await app.close();
  }
});

test("existing workspace authorization, replay revocation and user-scoped keys", async () => {
  const { app, intake, owner, count, headers } = await setup();
  try {
    const other = app.store.register({
      name: "Other",
      email: "other@example.com",
      password: "Password123!",
    });
    const otherHeaders = { authorization: `Bearer ${other.token}` };
    const workspace = app.store.createWorkspace(owner.user.id, "Existing");
    const payload = {
      requestId: randomUUID(),
      workspaceId: workspace.id,
      text: "Contract text",
    };
    assert.equal((await intake(payload, {} as any)).statusCode, 401);
    assert.equal((await intake(payload, otherHeaders)).statusCode, 404);
    app.store.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(workspace.id, other.user.id, "VIEWER");
    assert.equal((await intake(payload, otherHeaders)).statusCode, 403);
    assert.equal((await intake(payload)).statusCode, 201);
    assert.equal(count("workspaces"), 1);
    const key = randomUUID();
    const [a, b] = await Promise.all([
      intake({ requestId: key, text: "Personal contract" }),
      intake({ requestId: key, text: "Personal contract" }, otherHeaders),
    ]);
    assert.notEqual(a.json().workspace.id, b.json().workspace.id);
    app.store.db
      .prepare("DELETE FROM memberships WHERE user_id=? AND workspace_id=?")
      .run(owner.user.id, workspace.id);
    assert.equal((await intake(payload)).statusCode, 404);
    assert.notEqual(
      (
        await app.inject({
          method: "POST",
          url: `/api/workspaces/${workspace.id}/name`,
          headers: otherHeaders,
          payload: { name: "Hijacked" },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/agreements/intake",
          headers,
          payload: {
            requestId: randomUUID(),
            text: "text",
            workspaceId: "not uuid",
          },
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});

test("concurrent DOCX retries retain original once and infer filename without external AI", async () => {
  const { app, intake, headers, count } = await setup();
  try {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Maya receives 50 percent.</w:t></w:r></w:p></w:body></w:document>',
    );
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    const payload = {
      requestId: randomUUID(),
      filename: "Studio_Royalties.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      base64: bytes.toString("base64"),
    };
    const responses = await Promise.all([intake(payload), intake(payload)]);
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort(),
      [200, 201],
    );
    assert.deepEqual(responses[0].json(), responses[1].json());
    const result = responses[0].json();
    assert.equal(result.agreement.value.name, "Studio Royalties");
    assert.equal(count("workspaces"), 1);
    const url = `/api/workspaces/${result.workspace.id}/collaborations/${result.agreement.id}/documents/${result.document.documentId}`;
    const detail = (await app.inject({ url, headers })).json();
    assert.equal(detail.extraction, null);
    assert.deepEqual(
      (await app.inject({ url: url + "/original", headers })).rawPayload,
      bytes,
    );
  } finally {
    await app.close();
  }
});
