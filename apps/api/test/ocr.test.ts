import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { extractPdfOcr } from "../src/ocr.js";
import { extractPdf } from "../src/pdf.js";
import { buildApp } from "../src/app.js";
const bytes = readFileSync(
  new URL("./fixtures/scanned-agreement.pdf", import.meta.url),
);
const expectedEngine =
  process.platform === "darwin"
    ? "apple-vision+pdfkit"
    : "poppler+tesseract";
const available =
  process.platform === "darwin"
    ? spawnSync("/usr/bin/xcrun", ["--find", "swiftc"]).status === 0
    : ["pdfinfo", "pdftoppm", "tesseract"].every(
        (binary) =>
          spawnSync(binary, [binary === "tesseract" ? "--version" : "-v"], {
            env: { PATH: "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin" },
          }).status === 0,
      );
test(
  "local OCR reads an image-only PDF and marks immutable source as OCR requiring review",
  { skip: !available },
  async () => {
    await assert.rejects(
      extractPdf(bytes),
      (e: any) => e.code === "PDF_NO_EXTRACTABLE_TEXT",
    );
    const result = await extractPdfOcr(bytes);
    assert.match(result.text, /Maya receives 50 percent/);
    assert.match(result.text, /Riley receives 20 percent/);
    assert.equal(result.extraction.engine, expectedEngine);
    assert.equal(result.extraction.ocr, true);
    assert.equal(result.extraction.reviewRequired, true);
    assert.equal(result.pages.length, 1);
    assert.equal(
      result.text.slice(result.pages[0].start, result.pages[0].end),
      result.text,
    );
  },
);
test("local OCR validates file and timeout without echoing document data", async () => {
  await assert.rejects(
    extractPdfOcr(Buffer.from("not PDF")),
    (e: any) => e.code === "INVALID_PDF",
  );
  await assert.rejects(
    extractPdfOcr(bytes, { timeoutMs: 0 }),
    (e: any) => e.code === "OCR_TIMEOUT" && !e.message.includes("Maya"),
  );
});
test("OCR is disabled by default and never runs merely because file has no text", async () => {
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
    const capabilities = await app.inject({
      url: path + "/capabilities",
      headers,
    });
    assert.equal(capabilities.json().localOcrEnabled, false);
    const result = await app.inject({
      method: "POST",
      url: path + "/pdf",
      headers,
      payload: {
        mimeType: "application/pdf",
        base64: bytes.toString("base64"),
        useLocalOcr: true,
      },
    });
    assert.equal(result.statusCode, 400);
    assert.equal(result.json().error.code, "OCR_UNAVAILABLE");
    assert.equal(
      (await app.inject({ url: path, headers })).json().documents.length,
      0,
    );
  } finally {
    await app.close();
  }
});
test(
  "enabled OCR requires explicit request flag and persists original plus marked provenance",
  { skip: !available },
  async () => {
    const app = await buildApp({ dbPath: ":memory:", localOcrEnabled: true });
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
      const denied = await app.inject({
        method: "POST",
        url: path + "/pdf",
        headers,
        payload: {
          mimeType: "application/pdf",
          base64: bytes.toString("base64"),
        },
      });
      assert.equal(denied.json().error.code, "PDF_NO_EXTRACTABLE_TEXT");
      const response = await app.inject({
        method: "POST",
        url: path + "/pdf",
        headers,
        payload: {
          mimeType: "application/pdf",
          base64: bytes.toString("base64"),
          useLocalOcr: true,
        },
      });
      assert.equal(response.statusCode, 201, response.body);
      assert.equal(response.json().provenance.ocr, true);
      const doc = (
        await app.inject({
          url: path + "/" + response.json().documentId,
          headers,
        })
      ).json();
      assert.equal(doc.extraction, null);
      assert.equal(doc.hasOriginal, true);
      assert.match(doc.text, /Maya receives/);
    } finally {
      await app.close();
    }
  },
);
test(
  "OCR refuses page-heavy PDFs before rasterizing and releases busy slot",
  { skip: !available },
  async () => {
    const many = Buffer.from(bytes);
    const position = many.indexOf(Buffer.from("/Count 1"));
    assert.ok(position > 0);
    many[position + 7] = "6".charCodeAt(0);
    await assert.rejects(
      extractPdfOcr(many),
      (e: any) => e.code === "OCR_PAGE_LIMIT",
    );
    const result = await extractPdfOcr(bytes);
    assert.match(result.text, /Maya/);
  },
);
