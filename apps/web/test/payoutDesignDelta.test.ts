import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const grid = readFileSync(
  new URL("../src/components/PaymentGrid.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(
  new URL("../components/fairshare-app.tsx", import.meta.url),
  "utf8",
);
test("payout header owns the export action without duplicating its toolbar action", () => {
  assert.match(grid, /title && <header/);
  assert.match(grid, /!title && <button[^\n]+Export CSV/);
  assert.match(grid, /disabled=\{loading \|\| !filteredRows.length\}/);
});
test("payout empty-state action navigates to real agreements without inventing payment confirmation", () => {
  assert.match(
    app,
    /emptyActions=\{<Button[^\n]+navigate\(Section.Agreements\)[^\n]+View agreements/,
  );
  assert.match(grid, /An allocation alone does not move money/);
  assert.match(grid, /!loading && !data.rows.length/);
  assert.match(grid, /No matching payouts/);
});
