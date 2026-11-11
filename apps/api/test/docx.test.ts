import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { extractDocx, decodeDocxBase64, MAX_DOCX_BYTES } from "../src/docx.js";
import { buildApp } from "../src/app.js";
const mime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
async function docx(text = "Maya receives 50 percent.", macro = false) {
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  z.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  if (macro) z.file("word/vbaProject.bin", "not executed");
  return z.generateAsync({ type: "nodebuffer" });
}
test("DOCX extracts raw text locally with deterministic hash and no automatic AI", async () => {
  const bytes = await docx();
  const out = await extractDocx(bytes);
  assert.equal(out.text, "Maya receives 50 percent.");
  assert.equal(
    out.sourceFileSha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(out.extraction.ocr, false);
  assert.equal(out.extraction.readingOrder, "DOCUMENT_XML");
  assert.deepEqual(decodeDocxBase64(bytes.toString("base64")), bytes);
});
test("DOCX rejects malformed, macro, empty, excessive text and timeout", async () => {
  assert.throws(() => decodeDocxBase64("broken"));
  assert.throws(() =>
    decodeDocxBase64(Buffer.from("not zip").toString("base64")),
  );
  assert.throws(() =>
    decodeDocxBase64("a".repeat(Math.ceil(MAX_DOCX_BYTES / 3) * 4 + 4)),
  );
  await assert.rejects(
    extractDocx(await docx("hello", true)),
    (e: any) => e.code === "INVALID_DOCX",
  );
  await assert.rejects(
    extractDocx(await docx("")),
    (e: any) => e.code === "DOCX_NO_EXTRACTABLE_TEXT",
  );
  await assert.rejects(
    extractDocx(await docx("a".repeat(40001))),
    (e: any) => e.code === "DOCX_TEXT_LIMIT",
  );
  await assert.rejects(
    extractDocx(await docx(), { timeoutMs: 1 }),
    (e: any) => e.code === "DOCX_EXTRACTION_TIMEOUT",
  );
});
test("DOCX applies the text limit after normalization", async () => {
  const normalizedAtLimit = "a".repeat(40000) + "\u00ad";
  assert.equal(
    (await extractDocx(await docx(normalizedAtLimit))).text.length,
    40000,
  );
  await assert.rejects(
    extractDocx(await docx("a".repeat(40001) + "\u00ad")),
    (e: any) => e.code === "DOCX_TEXT_LIMIT",
  );
});
test("original downloads preserve bytes, require agreement membership, are attachments and remain pinned", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const owner = app.store.register({
      name: "Owner",
      email: "owner@example.com",
      password: "Password123!",
    });
    const headers = { authorization: `Bearer ${owner.token}` };
    const ws = app.store.createWorkspace(owner.user.id, "Studio");
    const base = `/api/workspaces/${ws.id}/collaborations`;
    const c = (
      await app.inject({
        method: "POST",
        url: base,
        headers,
        payload: { name: "Contract" },
      })
    ).json();
    const path = `${base}/${c.id}/documents`;
    const bytes = await docx();
    const uploaded = await app.inject({
      method: "POST",
      url: path + "/docx",
      headers,
      payload: { mimeType: mime, base64: bytes.toString("base64") },
    });
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    const id = uploaded.json().documentId;
    const detail = (await app.inject({ url: path + "/" + id, headers })).json();
    assert.equal(detail.hasOriginal, true);
    assert.equal(detail.extraction, null);
    const original = await app.inject({
      url: path + "/" + id + "/original",
      headers,
    });
    assert.equal(original.statusCode, 200);
    assert.deepEqual(original.rawPayload, bytes);
    assert.match(
      String(original.headers["content-disposition"]),
      /^attachment;/,
    );
    assert.match(String(original.headers["cache-control"]), /no-store/);
    assert.equal(original.headers["x-content-type-options"], "nosniff");
    assert.equal(
      (await app.inject({ url: path + "/" + id + "/original" })).statusCode,
      401,
    );
    const outsider = app.store.register({
      name: "Other",
      email: "other@example.com",
      password: "Password123!",
    });
    assert.notEqual(
      (
        await app.inject({
          url: path + "/" + id + "/original",
          headers: { authorization: `Bearer ${outsider.token}` },
        })
      ).statusCode,
      200,
    );
    const text = (
      await app.inject({
        method: "POST",
        url: path,
        headers,
        payload: { text: "Text only source" },
      })
    ).json();
    assert.equal(
      (await app.inject({ url: path + "/" + text.documentId, headers })).json()
        .hasOriginal,
      false,
    );
    assert.equal(
      (
        await app.inject({
          url: path + "/" + text.documentId + "/original",
          headers,
        })
      ).statusCode,
      404,
    );
    assert.deepEqual(
      (await app.inject({ url: path + "/" + id + "/original", headers }))
        .rawPayload,
      bytes,
    );
  } finally {
    await app.close();
  }
});

test("DOCX rejects highly compressed oversized entries before text extraction", async () => {
  const zip = await JSZip.loadAsync(await docx());
  zip.file("word/large.xml", "x".repeat(11 * 1024 * 1024));
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  assert.ok(bytes.length < 100000);
  await assert.rejects(
    extractDocx(bytes),
    (e: any) => e.code === "INVALID_DOCX",
  );
});
