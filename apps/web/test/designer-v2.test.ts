import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";
const source = readFileSync(
  new URL("../components/agreement-widgets.tsx", import.meta.url),
  "utf8",
);
test("revised agreement filter is labelled, native and wired to existing filter state", () => {
  assert.match(
    source,
    /<select\s+aria-label="Filter agreements by status"\s+value=\{filter\}\s+onChange=\{\(event\)\s*=>\s*setFilter\(event\.target\.value\)\}/,
  );
  assert.match(source, /\["All", \.\.\.Object\.values\(ListStatus\)\]/);
  assert.match(
    source,
    /filter\s*===\s*"All"\s*\|\|\s*agreementStatus\(a, isDraft\(a\)\)\s*===\s*filter/,
  );
  assert.doesNotMatch(source, /className="filter-tabs"/);
  assert.match(source, /No matching agreements/);
});
test("overview reuses the revenue rules card, without setup banners or hedges", () => {
  const app = appSource();
  assert.match(app, /<RevenueRulesCard/);
  assert.match(app, /version=\{shown\}/);
  assert.match(app, /Change the agreement/);
  assert.match(app, /Read the agreement →/);
  assert.match(
    app,
    /const shown = active \?\? selected\.value\.versions\.at\(-1\)/,
  );
  assert.match(app, /No split yet\. Agree on one in Agreement\./);
  assert.doesNotMatch(app, /Agree on the rules first|Set up terms/);
  assert.doesNotMatch(app, /This\s+is\s+not\s+proof\s+of/);
});
