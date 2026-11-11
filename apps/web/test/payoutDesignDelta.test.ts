import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";

const grid = readFileSync(
  new URL("../src/components/PaymentGrid.tsx", import.meta.url),
  "utf8",
);
const app = appSource();
test("payout header owns the export action without duplicating its toolbar action", () => {
  assert.match(grid, /title\s*&&\s*\(\s*<header/);
  assert.match(grid, /!title\s*&&\s*\([\s\S]*?<button[\s\S]+?Export CSV/);
  assert.match(grid, /disabled=\{loading\s*\|\|\s*!filteredRows\.length\}/);
});
test("payout empty-state action navigates to real agreements without inventing payment confirmation", () => {
  assert.match(
    app,
    /emptyActions=\{\s*<Button[\s\S]+?navigate\(Section\.Agreements\)[\s\S]+?View agreements/,
  );
  assert.match(grid, /An allocation alone does not move money/);
  assert.match(grid, /!loading && !data.rows.length/);
  assert.match(grid, /No matching payouts/);
});
