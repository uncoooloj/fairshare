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
test("overview shows the split in sentences, without setup banners or hedges", () => {
  const app = appSource();
  assert.match(app, /splitSentences\(selected, shown\.rules, user\.id\)/);
  assert.match(app, /Nothing is paid until everyone approves\./);
  assert.doesNotMatch(app, /Agree on the rules first|Set up terms/);
  assert.doesNotMatch(app, /This\s+is\s+not\s+proof\s+of/);
});
