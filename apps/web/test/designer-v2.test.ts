import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/agreement-widgets.tsx", import.meta.url),
  "utf8",
);
test("revised agreement filter is labelled, native and wired to existing filter state", () => {
  assert.match(
    source,
    /<select\s+aria-label="Filter agreements by status"\s+value=\{filter\}\s+onChange=\{\(event\)\s*=>\s*setFilter\(event\.target\.value\)\}/,
  );
  assert.match(
    source,
    /\["All", "Draft", "In review", "Approved", "Needs attention"\]/,
  );
  assert.match(
    source,
    /filter\s*===\s*"All"\s*\|\|\s*agreementStatus\(a\)\s*===\s*filter/,
  );
  assert.doesNotMatch(source, /className="filter-tabs"/);
  assert.match(source, /No matching agreements/);
});
test("only active rules collapse, leaving setup and recoupment actions outside", () => {
  const app = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  const disclosure = readFileSync(
    new URL("../components/revenue-rules.tsx", import.meta.url),
    "utf8",
  );
  assert.match(disclosure, /useState\(true\)/);
  assert.match(disclosure, /<summary>Revenue rules<\/summary>/);
  assert.match(
    app,
    /<RevenueRules\s+key=\{\x60\$\{selected\.id\}:\$\{active\.id\}\x60\}>/,
  );
  assert.match(app, /<\/RevenueRules>\s*\)\s*:\s*\(\s*<Empty/);
  assert.match(app, /Set up terms/);
  assert.match(app, /allocated toward recoupment\.\s+This is not proof\s+of/);
});
