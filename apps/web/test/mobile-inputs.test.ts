import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("phone controls stay at least 16px despite component font overrides", () => {
  const css = source("../app/globals.css");
  assert.match(
    css,
    /@media\s*\(max-width: 767px\)\s*\{\s*input,\s*select,\s*textarea\s*\{\s*font-size: max\(16px, 1rem\) !important;/,
  );
});

test("mobile focus fix does not prevent users from zooming", () => {
  const layout = source("../app/layout.tsx");
  assert.doesNotMatch(
    layout,
    /userScalable\s*:\s*false|maximumScale\s*:\s*1|user-scalable=no|maximum-scale=1/,
  );
  const css = source("../app/globals.css");
  assert.doesNotMatch(css, /touch-action\s*:\s*none/);
});

test("selects and text inputs share a 44px minimum control size", () => {
  const css = source("../app/globals.css");
  const tokens = source("../app/tokens.css");
  assert.match(tokens, /--control-min-height: 44px/);
  assert.match(
    css,
    /input:not\(\[type="checkbox"\]\).*\nselect \{\s*min-height: var\(--control-min-height\);\s*line-height: var\(--control-line-height\)/,
  );
  assert.match(
    css,
    /select:not\(\[multiple\]\):not\(\[size\]\) \{\s*appearance: none;\s*-webkit-appearance: none;/,
  );
  assert.match(css, /background-position: right 12px center/);
  assert.doesNotMatch(css, /min-height: 34px/);
});
