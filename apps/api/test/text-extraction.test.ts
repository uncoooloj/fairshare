import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { extractPdf } from "../src/pdf.js";
import { extractDocx } from "../src/docx.js";
import {
  assembleOcrPages,
  crossCheckLines,
  parseTesseractTsv,
  type OcrLine,
} from "../src/ocr.js";
import {
  layoutPage,
  normalizeExtractedText,
  type LayoutLine,
} from "../src/textLayout.js";
import { buildApp } from "../src/app.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

// Chromium page.pdf in Helvetica: the fi/ffi ligatures arrive as separate
// glyph runs ("of" + "fi" + "ce"), which previously became "of fi ce".
test("PDF text keeps ligature words whole and rebuilds paragraphs", async () => {
  const result = await extractPdf(fixture("ligatures.pdf"));
  for (const word of ["fifty", "fifteenth", "office"])
    assert.match(result.text, new RegExp(`\\b${word}\\b`));
  assert.doesNotMatch(result.text, /fi fty|of fi|  /);
  assert.equal(
    result.text,
    [
      "Revenue Sharing Agreement",
      "1. Parties. This agreement is made between Maya, Riley and the office of Café Naïve, effective from the fifteenth day of the month, and it binds every party listed here.",
      "4.2 Division. Net Revenue is split fifty percent to Maya, thirty percent to Sam and twenty percent (20%) to Riley, before any division of costs under § 7 and “Expenses”.",
      "4.3 Payments. Each party receives €1,000 monthly.",
    ].join("\n\n"),
  );
  assert.deepEqual(result.pages, [
    { page: 1, start: 0, end: result.text.length },
  ]);
});

const line = (text: string, y: number, right = 500, size = 10): LayoutLine => ({
  text,
  x: 50,
  y,
  right,
  size,
});

test("layout joins soft wraps but never merges across clause numbers or headings", () => {
  const { text } = layoutPage([
    line("Revenue Share", 800, 200, 18),
    line(
      "4.1 Advance. The Producer has advanced two thousand dollars toward",
      770,
    ),
    line("recording costs, recouped before any division.", 758, 300),
    line("4.2 Division. Net Revenue is divided fifty percent to Maya and", 746),
    line("twenty percent to a non-", 734, 495),
    line("exclusive payee.", 722, 150),
    line("(a) Riley receives the remainder.", 710, 250),
    line("Payments", 685, 120),
    line("Each party is paid monthly.", 673, 200),
  ]);
  assert.equal(
    text,
    [
      "Revenue Share\n",
      "4.1 Advance. The Producer has advanced two thousand dollars toward recording costs, recouped before any division.",
      "4.2 Division. Net Revenue is divided fifty percent to Maya and twenty percent to a non-exclusive payee.",
      "(a) Riley receives the remainder.\n",
      "Payments",
      "Each party is paid monthly.",
    ].join("\n"),
  );
});

test("layout joins a trailing soft hyphen at a line wrap", () => {
  const { text } = layoutPage([
    line("The non­", 800, 495),
    line("exclusive licence applies.", 788, 200),
  ]);
  assert.equal(text, "The nonexclusive licence applies.");
});

test("layout joins a soft-hyphen-wrapped proper name", () => {
  const { text } = layoutPage([line("Pay­", 800, 495), line("Pal", 788, 200)]);
  assert.equal(text, "PayPal");
});

test("normalization expands ligatures but keeps meaning-bearing characters", () => {
  assert.equal(
    normalizeExtractedText(
      "  ﬁfty ﬃce  § 7 “Notices” – €100, ½ share™\r\n\n\n\nNext­",
    ),
    "fifty ffice § 7 “Notices” – €100, ½ share™\n\nNext",
  );
});

test(
  "DOCX paragraphs are separated by exactly one blank line",
  { skip: process.platform !== "darwin" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "fairshare-docx-"));
    try {
      const html = join(directory, "agreement.html");
      writeFileSync(
        html,
        '<meta charset="utf-8"><p>4.1 Advance.</p><p></p><p></p><p>4.2 Division of fifty percent.</p><p>&nbsp;</p><p>§ 7 “Notices” €100</p>',
      );
      const docx = join(directory, "agreement.docx");
      assert.equal(
        spawnSync("textutil", ["-convert", "docx", html, "-output", docx])
          .status,
        0,
      );
      const result = await extractDocx(readFileSync(docx));
      assert.equal(
        result.text,
        "4.1 Advance.\n\n4.2 Division of fifty percent.\n\n§ 7 “Notices” €100",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

const ocrLine = (text: string, y: number, confidence = 1): OcrLine => ({
  ...line(text, y, 300),
  confidence,
});

test("OCR lines the two passes disagree on are flagged, amounts strictly", () => {
  const lines = crossCheckLines(
    [
      ocrLine("4.2 Division. Twenty percent (20%) to", 700),
      ocrLine("Riley.", 688),
      ocrLine("S. Payments", 660),
      ocrLine("Each party is paid monthly.", 640),
    ],
    [
      { text: "4.2 Division. Twenty percent (20%) to", y: 700, size: 10 },
      { text: "5. Payments", y: 660, size: 10 },
      { text: "Each party is paid monthly.", y: 640, size: 10 },
    ],
  );
  assert.deepEqual(
    lines.map((entry) => entry.confidence < 1),
    [false, true, true, false],
  );
  const { text, quality } = assembleOcrPages([{ lines }]);
  assert.equal(quality.lowConfidence, true);
  assert.equal(quality.lowConfidenceLines, 2);
  assert.deepEqual(
    quality.lowConfidenceRanges.map((range) => [
      text.slice(range.start, range.end),
      range.amount,
    ]),
    [
      ["Riley.", false],
      ["S. Payments", true],
    ],
  );
  assert.ok(quality.confidence > 0 && quality.confidence < 1);
});

test("clean OCR reports full confidence without a warning", () => {
  const { quality } = assembleOcrPages([
    { lines: [ocrLine("Maya receives 50 percent.", 700)] },
  ]);
  assert.deepEqual(quality, {
    confidence: 1,
    lowConfidenceLines: 0,
    lowConfidence: false,
    lowConfidenceRanges: [],
  });
});

test("Tesseract TSV becomes positioned lines with the weakest word's confidence", () => {
  const header =
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
  const rows = [
    "1\t1\t0\t0\t0\t0\t0\t0\t1000\t1400\t-1\t",
    "4\t1\t1\t1\t1\t0\t100\t100\t300\t20\t-1\t",
    "5\t1\t1\t1\t1\t1\t100\t100\t80\t20\t96.5\tRiley",
    "5\t1\t1\t1\t1\t2\t190\t100\t60\t20\t41.0\t20%",
    "5\t1\t1\t1\t2\t1\t100\t130\t90\t20\t95\tMaya",
  ];
  const lines = parseTesseractTsv([header, ...rows].join("\n"));
  assert.deepEqual(lines, [
    {
      text: "Riley 20%",
      x: 100,
      y: 1280,
      right: 250,
      size: 20,
      confidence: 0.41,
    },
    { text: "Maya", x: 100, y: 1250, right: 190, size: 20, confidence: 0.95 },
  ]);
  const { quality } = assembleOcrPages([{ lines }]);
  assert.equal(quality.lowConfidenceLines, 1);
  assert.equal(quality.lowConfidenceRanges[0].amount, true);
});

test("a scan uploaded while OCR is disabled gets a clear scan error", async () => {
  const app = await buildApp({ dbPath: ":memory:" });
  try {
    const owner = app.store.register({
      name: "Maya",
      email: "maya@example.com",
      password: "Password123!",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/agreements/intake",
      headers: { authorization: `Bearer ${owner.token}` },
      payload: {
        requestId: randomUUID(),
        mimeType: "application/pdf",
        filename: "scan.pdf",
        base64: fixture("scanned-agreement.pdf").toString("base64"),
      },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json().error, {
      code: "SCANNED_PDF_UNSUPPORTED",
      message:
        "This looks like a scanned document. We can't read scans yet. Upload the original PDF or Word file.",
    });
  } finally {
    await app.close();
  }
});
