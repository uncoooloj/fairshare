import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DocumentMode,
  DocumentStep,
  MAX_DOCUMENT_BYTES,
  validateDocumentFile,
} from "../components/document-step";
import {
  UNREADABLE_DETAIL,
  unreadableDetail,
} from "../components/wizard-intake";
import { ApiError } from "../lib/model";

const dropZoneSource = readFileSync(
  new URL("../components/drop-zone.tsx", import.meta.url),
  "utf8",
);
const noop = () => {};
const render = (props: Partial<Parameters<typeof DocumentStep>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(DocumentStep, {
      file: null,
      text: "",
      mode: DocumentMode.UPLOAD,
      onFile: noop,
      onText: noop,
      onMode: noop,
      ...props,
    }),
  );
const sized = (name: string, bytes: number, type = "") =>
  new File([new Uint8Array(bytes)], name, { type });

test("empty state is a drop zone with the server's real types and limit", () => {
  const html = render();
  assert.match(html, /Drop the signed agreement here or/);
  assert.match(html, /browse/);
  assert.match(html, /PDF, Word or text, up to 5 MB/);
  assert.doesNotMatch(html, /25 MB/);
  assert.match(html, /type="file"/);
  assert.match(html, /accept="\.pdf,\.docx,\.txt/);
  assert.match(html, />Paste the text instead</);
  assert.equal(MAX_DOCUMENT_BYTES, 5 * 1024 * 1024);
});

test("selected state shows a file card with icon, size, status, Replace and Remove", () => {
  const html = render({
    file: sized("Revenue Share Agreement.pdf", 2.4 * 1024 * 1024),
  });
  assert.match(html, /Revenue Share Agreement\.pdf/);
  assert.match(html, /2\.4 MB · Ready to read/);
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /file-chip-icon[^>]*>PDF</);
  assert.match(html, /aria-label="Remove file"/);
  assert.match(html, />Replace</);
  assert.doesNotMatch(html, /drop-zone-browse/);
  // The picker input stays mounted so Replace can open it, but is not a tab stop.
  assert.match(
    html,
    /type="file"[^>]*tabindex="-1"|tabindex="-1"[^>]*type="file"/,
  );
});

test("unreadable state replaces the file card with an error card", () => {
  const html = render({
    file: sized("Midnight-Sessions-scan.pdf", 1024),
    // The wizard passes the card's line: the default, or the server's scan message.
    error: UNREADABLE_DETAIL,
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /Midnight-Sessions-scan\.pdf/);
  assert.match(html, /We couldn’t open this file/);
  assert.match(
    html,
    /It might be password-protected or a scan we can’t read\./,
  );
  assert.match(html, />Try another file</);
  const scan = render({
    file: sized("scan.pdf", 1024),
    error: unreadableDetail(
      new ApiError(
        "This looks like a scanned document. We can't read scans yet. Upload the original PDF or Word file.",
        400,
        "SCANNED_PDF_UNSUPPORTED",
      ),
    ),
  });
  assert.match(scan, /We couldn’t open this file/);
  assert.match(scan, /We can&#x27;t read scans yet/);
  assert.equal(unreadableDetail(new Error("network")), UNREADABLE_DETAIL);
  assert.doesNotMatch(html, /aria-label="Remove file"/);
  assert.match(html, /type="file"/);
});

test("Replace and Try another file open the picker instead of only clearing", () => {
  assert.match(dropZoneSource, /input\.current\.click\(\)/);
  assert.match(dropZoneSource, /onClick=\{openPicker\}\s*>\s*Replace/);
  assert.match(dropZoneSource, /onClick=\{openPicker\}\s*>\s*Try another file/);
});

test("paste mode keeps the 40,000 character limit and a way back", () => {
  const html = render({ mode: DocumentMode.PASTE, text: "Clause 1" });
  assert.match(html, /<textarea[^>]*maxLength="40000"/);
  assert.match(html, /Clause 1/);
  assert.match(html, /8 \/ 40,000 characters/);
  assert.match(html, />Upload a file instead</);
  assert.doesNotMatch(html, /type="file"/);
});

test("disabled locks every control", () => {
  const html = render({ file: sized("a.pdf", 10), disabled: true });
  assert.equal(html.match(/disabled=""/g)?.length, 4);
});

test("validateDocumentFile rejects wrong types, empty and oversize files", () => {
  assert.equal(
    validateDocumentFile(sized("a.pdf", 10, "application/pdf")),
    undefined,
  );
  assert.equal(validateDocumentFile(sized("a.DOCX", 10)), undefined);
  assert.equal(
    validateDocumentFile(sized("notes.txt", 10, "text/plain")),
    undefined,
  );
  assert.equal(
    validateDocumentFile(sized("a.pdf", MAX_DOCUMENT_BYTES)),
    undefined,
  );
  assert.match(
    validateDocumentFile(sized("photo.png", 10, "image/png")) ?? "",
    /PDF, Word or text/,
  );
  assert.match(
    validateDocumentFile(sized("old.doc", 10)) ?? "",
    /PDF, Word or text/,
  );
  assert.match(
    validateDocumentFile(sized("big.pdf", MAX_DOCUMENT_BYTES + 1)) ?? "",
    /no larger than 5 MB/,
  );
  assert.match(validateDocumentFile(sized("empty.pdf", 0)) ?? "", /empty/);
});
