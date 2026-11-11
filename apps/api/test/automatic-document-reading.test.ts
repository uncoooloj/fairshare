import test from "node:test";
import assert from "node:assert/strict";
import {
  readUploadedPdf,
  type DocumentReaders,
} from "../src/documentReaders.js";
const bytes = Buffer.from("synthetic document");
function fixture(code?: string) {
  const calls: string[] = [];
  const text = { text: "native text", extraction: { ocr: false } };
  const scan = { text: "scan text", extraction: { ocr: true } };
  const error = Object.assign(new Error("cannot read"), { code });
  const readers = {
    pdf: async (input: Buffer) => {
      assert.equal(input, bytes);
      calls.push("pdf");
      if (code) throw error;
      return text;
    },
    ocr: async (input: Buffer) => {
      assert.equal(input, bytes);
      calls.push("ocr");
      return scan;
    },
  } as unknown as DocumentReaders;
  return { readers, calls, text, scan, error };
}
test("text PDFs never invoke scan processing even when enabled", async () => {
  const f = fixture();
  assert.equal(
    await readUploadedPdf(f.readers, bytes, { ocrEnabled: true }),
    f.text,
  );
  assert.deepEqual(f.calls, ["pdf"]);
});
test("textless PDFs automatically read scans once and preserve scan provenance", async () => {
  const f = fixture("PDF_NO_EXTRACTABLE_TEXT");
  assert.equal(
    await readUploadedPdf(f.readers, bytes, { ocrEnabled: true }),
    f.scan,
  );
  assert.deepEqual(f.calls, ["pdf", "ocr"]);
});
test("a disabled legacy scan request cannot invoke scan processing", async () => {
  const f = fixture("PDF_NO_EXTRACTABLE_TEXT");
  await assert.rejects(
    readUploadedPdf(f.readers, bytes, { ocrEnabled: false, forceOcr: true }),
    (e: any) => e.code === "SCANNED_PDF_UNSUPPORTED",
  );
  assert.deepEqual(f.calls, ["pdf"]);
});
test("a legacy explicit scan request preserves direct scan processing", async () => {
  const f = fixture();
  assert.equal(
    await readUploadedPdf(f.readers, bytes, {
      ocrEnabled: true,
      forceOcr: true,
    }),
    f.scan,
  );
  assert.deepEqual(f.calls, ["ocr"]);
});
test("limits, locked files, outages and parser failures never trigger fallback", async () => {
  for (const code of [
    "PDF_TOO_LARGE",
    "PDF_PASSWORD_REQUIRED",
    "PDF_PAGE_LIMIT",
    "PDF_TEXT_LIMIT",
    "PDF_BUSY",
    "PDF_EXTRACTION_TIMEOUT",
    "PDF_EXTRACTION_FAILED",
    "INVALID_PDF",
  ]) {
    const f = fixture(code);
    await assert.rejects(
      readUploadedPdf(f.readers, bytes, { ocrEnabled: true }),
      (e) => e === f.error,
    );
    assert.deepEqual(f.calls, ["pdf"]);
  }
});
test("scan failure is returned without another attempt", async () => {
  const f = fixture("PDF_NO_EXTRACTABLE_TEXT");
  const error = new Error("scan unreadable");
  f.readers.ocr = async () => {
    f.calls.push("ocr");
    throw error;
  };
  await assert.rejects(
    readUploadedPdf(f.readers, bytes, { ocrEnabled: true }),
    (e) => e === error,
  );
  assert.deepEqual(f.calls, ["pdf", "ocr"]);
});
