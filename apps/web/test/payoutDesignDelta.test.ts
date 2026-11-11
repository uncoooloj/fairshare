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
    /emptyActions=\{\s*<button[\s\S]+?navigate\(Section\.Agreements\)[\s\S]+?Go to Agreements/,
  );
  assert.match(
    grid,
    /When a payment splits, each person's payout shows here\./,
  );
  assert.match(grid, /!loading && !data.rows.length/);
  assert.match(grid, /No matching payouts/);
});
test("payout grid: one pager only above a page, info tooltips, no fake dates", () => {
  assert.match(grid, /PAYOUT_PAGE_SIZE = 20/);
  assert.match(grid, /pagination=\{paginated\}/);
  assert.match(grid, /paginationPageSizeSelector=\{false\}/);
  assert.match(grid, /\{!paginated && \(/);
  assert.match(grid, /aria-describedby=\{`\$\{tipId\}-\$\{card\.kind\}`\}/);
  assert.match(grid, /role="tooltip"/);
  assert.doesNotMatch(grid, /Not recorded/);
  assert.doesNotMatch(grid, /height: 460/);
});
test("payout grid resets pager state when external filters change the row count", () => {
  assert.match(
    grid,
    /const paginated = !loading && filteredRows\.length > PAYOUT_PAGE_SIZE/,
  );
  assert.match(grid, /api\.setGridOption\("pagination", paginated\)/);
  assert.match(grid, /api\.paginationGoToFirstPage\(\)/);
  assert.doesNotMatch(
    grid,
    /key=\{`\$\{paginated\}:\$\{status\}:\$\{query\}`\}/,
  );
});
test("payout grid resets the global .ag-header margin that overlapped the first row", () => {
  const css = readFileSync(
    new URL("../src/components/payouts.module.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.grid :global\(\.ag-header\) \{\s*margin: 0;/);
});

test("payout rows open their own details without taking over controls or the global refresh", () => {
  const section = readFileSync(
    new URL("../components/sections/payouts-section.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(section, />\s*Refresh\s*</);
  assert.doesNotMatch(section, /\/payouts\/\$\{p\.id\}\/reconcile/);
  assert.doesNotMatch(grid, /Totals are for all time\./);
  assert.match(
    grid,
    /onCellClicked=\{\(event\) => \{[\s\S]*?openPayoutDetails\(event\.data\)/,
  );
  assert.match(
    grid,
    /onCellKeyDown=\{\(event\) =>[\s\S]*?openPayoutFromKeyboard\(event\.event, event\.data\)/,
  );
  assert.match(grid, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(
    grid,
    /event\.stopPropagation\(\);[\s\S]*?onOpenAgreement\(row\.agreementKey\)/,
  );
  assert.match(
    grid,
    /event\.stopPropagation\(\);[\s\S]*?openPayoutDetails\(row\)/,
  );
});
