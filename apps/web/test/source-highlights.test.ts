import test from "node:test";
import assert from "node:assert/strict";
import { sourceHighlights, highlightSegments } from "../lib/source-highlights";
const source = "Maya receives 50%. Jordan receives 50%.";
const extraction = {
  documentId: "d",
  status: "REVIEW_REQUIRED",
  requiresHumanReview: true,
  executable: false,
  facts: [
    {
      kind: "SHARE",
      subject: "Maya",
      rawValue: "50%",
      citation: { start: 0, end: 17, quote: source.slice(0, 17) },
    },
  ],
};
test("highlights require matching document and exact saved source offsets", () => {
  assert.equal(sourceHighlights(extraction, "d", source).length, 1);
  assert.equal(sourceHighlights(extraction, "other", source).length, 0);
  assert.equal(
    sourceHighlights(extraction, "d", source.replace("Maya", "Rita")).length,
    0,
  );
  assert.equal(
    sourceHighlights({ ...extraction, executable: true }, "d", source).length,
    0,
  );
});
test("invalid or invented citation ranges are never highlighted", () => {
  for (const citation of [
    { start: -1, end: 17, quote: source.slice(0, 17) },
    { start: 0, end: 900, quote: source },
    { start: 0.2, end: 17, quote: source.slice(0, 17) },
    { start: 0, end: 17, quote: "Different term" },
  ]) {
    assert.deepEqual(
      sourceHighlights(
        { ...extraction, facts: [{ ...extraction.facts[0], citation }] },
        "d",
        source,
      ),
      [],
    );
  }
});
test("overlapping and shared citations preserve every source character once", () => {
  const highlights = sourceHighlights(extraction, "d", source);
  highlights.push({
    ...highlights[0],
    id: "overlap",
    start: 5,
    end: 25,
    quote: source.slice(5, 25),
  });
  const segments = highlightSegments(source, highlights);
  assert.equal(segments.map((item) => item.text).join(""), source);
  assert.ok(segments.some((item) => item.ids.length === 2));
  assert.equal(
    highlightSegments(source, [])
      .map((item) => item.text)
      .join(""),
    source,
  );
});
test("source remains literal text, including markup and Unicode", () => {
  const input = '<script>alert("not executed")</script> 🎵';
  assert.equal(
    highlightSegments(input, [])
      .map((item) => item.text)
      .join(""),
    input,
  );
});

test("context editor keeps cancel local, validates 100%, and does not write a contract", async () => {
  const { readFileSync } = await import("node:fs");
  const editor = readFileSync(
    new URL("../components/split-rule-editor.tsx", import.meta.url),
    "utf8",
  );
  assert.match(editor, /onClick=\{onCancel\}/);
  assert.match(editor, /disabled=\{total !== 10000\}/);
  assert.match(editor, /onApply\(draft\)/);
  assert.doesNotMatch(editor, /\bfetch\(|\bapi\(|dangerouslySetInnerHTML/);
  const source = readFileSync(
    new URL("../components/source-rule-context.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /contentEditable|dangerouslySetInnerHTML/);
});
