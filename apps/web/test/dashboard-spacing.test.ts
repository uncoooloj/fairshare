import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overviewCss = readFileSync(
  new URL("../app/overview-polish.css", import.meta.url),
  "utf8",
);
const payoutsCss = readFileSync(
  new URL("../src/components/payouts.module.css", import.meta.url),
  "utf8",
);

test("overview separates summary cards from content by its 24px panel gutter", () => {
  const stats = overviewCss.match(/\.ov-stats\s*\{([^}]+)\}/)?.[1];
  assert.ok(stats);
  assert.match(stats, /gap: 24px;/);
  assert.match(stats, /margin: 8px 0 24px;/);
  assert.match(overviewCss, /\.ov-grid\s*\{[^}]*gap: 24px;/);
});

test("payouts separate summary cards from empty states and filters by the card gutter", () => {
  const summary = payoutsCss.match(/\.summary\s*\{([^}]+)\}/)?.[1];
  assert.ok(summary);
  assert.match(summary, /gap: 16px;/);
  assert.match(summary, /margin-bottom: 16px;/);
});

test("stacked summary cards keep the larger section spacing on narrow screens", () => {
  const mobileOverview = overviewCss.match(
    /@media \(max-width: 720px\)\s*\{\s*\.ov-stats\s*\{([^}]+)\}/,
  )?.[1];
  const mobilePayouts = payoutsCss.match(
    /@media \(max-width: 680px\)\s*\{\s*\.summary\s*\{([^}]+)\}/,
  )?.[1];
  assert.ok(mobileOverview);
  assert.ok(mobilePayouts);
  for (const rules of [mobileOverview, mobilePayouts]) {
    assert.match(rules, /grid-template-columns: (?:minmax\(0, 1fr\)|1fr);/);
    assert.doesNotMatch(rules, /margin(?:-bottom)?:/);
  }
});
