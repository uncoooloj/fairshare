import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(
  new URL("../app/review-workbench.css", import.meta.url),
  "utf8",
);
test("review visual layer stays scoped and keeps mobile text legible", () => {
  assert.match(css, /\.source-rules-review/);
  assert.match(css, /max-width: 1100px/);
  assert.match(css, /max-width: 600px/);
  assert.match(css, /font-size: 16px/);
  assert.doesNotMatch(
    css,
    /display:\s*none|visibility:\s*hidden|pointer-events:\s*none/,
  );
});
test("source and proposal keep independent visual hierarchy without hiding controls", () => {
  assert.match(css, /\.review-source-text/);
  assert.match(css, /minmax\(0, 1fr\)/);
  assert.match(css, /\.rules-editor/);
  assert.match(css, /tabular-nums/);
  assert.match(css, /var\(--color-line\)/);
});
