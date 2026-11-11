import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatDay, formatExact, formatWhen } from "../lib/dates";
import { initials, toneForId, toneInRoster, PERSON_TONES } from "../lib/person";
import { appSource } from "./app-source";

const now = Date.parse("2026-11-11T12:00:00Z");

test("relative dates within a week, then short calendar dates", () => {
  assert.equal(formatWhen("2026-11-11T11:59:30Z", now), "just now");
  assert.equal(formatWhen("2026-11-11T11:15:00Z", now), "45m ago");
  assert.equal(formatWhen("2026-11-11T09:00:00Z", now), "3h ago");
  assert.equal(formatWhen("2026-11-08T12:00:00Z", now), "3d ago");
  assert.equal(formatWhen("2026-10-20T12:00:00Z", now), "Oct 20");
  assert.equal(formatDay("2025-10-20T12:00:00Z", now), "Oct 20, 2025");
  assert.equal(formatWhen(now - 2 * 60_000, now), "2m ago");
});

test("missing or invalid dates never render as Invalid Date", () => {
  assert.equal(formatWhen(undefined, now), "Not recorded");
  assert.equal(formatDay("nope", now), "Not recorded");
  assert.equal(formatExact(""), undefined);
});

test("initials use first and last name, single names stay one letter", () => {
  assert.equal(initials("Maya Okafor"), "MO");
  assert.equal(initials("Riley Ann Chen"), "RC");
  assert.equal(initials("Riley"), "R");
  assert.equal(initials("  "), "?");
});

test("roster tones are distinct within an agreement and stable outside it", () => {
  const roster = ["a", "b", "c", "d", "e", "f"].map((userId) => ({ userId }));
  const tones = roster.map((m) => toneInRoster(m.userId, roster));
  assert.equal(new Set(tones).size, 6);
  assert.equal(toneInRoster("a", roster), toneForId("a"));
  assert.equal(toneForId("user-1"), toneForId("user-1"));
  assert.ok(toneForId("user-1") < PERSON_TONES);
});

test("calculation drawer keeps provider and rounding detail behind a disclosure", () => {
  const source = readFileSync(
    new URL("../components/allocation-calculation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /<summary>Show working<\/summary>/);
  assert.match(source, /trace\.captureId/);
  assert.match(source, /roundingCents/);
});

test("motion respects reduced-motion preferences", () => {
  const css = readFileSync(
    new URL("../app/design-polish.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /::file-selector-button/);
});

test("historical allocation drawer never routes a saved clause to the current document", () => {
  const calculation = readFileSync(
    new URL("../components/allocation-calculation.tsx", import.meta.url),
    "utf8",
  );
  const allocations = readFileSync(
    new URL("../components/agreement-allocations.tsx", import.meta.url),
    "utf8",
  );
  // A generic tab switch cannot identify the allocation's original document/version.
  // Keep the saved source excerpt and document identity, not a misleading shortcut.
  assert.doesNotMatch(calculation, /Open in document|onOpenDocument/);
  assert.doesNotMatch(allocations, /onOpenDocument/);
  assert.match(calculation, /trace\.source\.excerpt/);
  assert.match(calculation, /trace\.source\.documentId/);
});

test("polish preserves personal finance and tenant-qualified identities", () => {
  const read = (name: string) =>
    readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
  const overview = read("overview-dashboard");
  assert.match(
    overview,
    /last\.agreement\.workspaceId === event\.agreement\.workspaceId/,
  );
  assert.match(
    overview,
    /JSON\.stringify\(\[event\.agreement\.workspaceId, event\.agreement\.id\]\)/,
  );
  assert.match(overview, /Your allocated share/);
  assert.match(overview, /your own share on the rest/);
  assert.match(overview, /payoutsComplete/);
  const card = read("agreement-workspace");
  assert.match(card, /overviewSummary\([\s\S]*payoutsComplete/);
  assert.match(card, /roster\.filter\(\(m\) => m\.userId === userId\)/);
  assert.match(card, /display\(summary\.paid\)/);
  assert.match(card, /payoutsUnavailable/);
  assert.match(card, /Loading totals/);
  assert.match(card, /Couldn't load payouts\. Refresh to try again/);
  assert.doesNotMatch(card, /payoutStatus\(p\.status\)/);
  const app = appSource();
  assert.match(app, /p\.agreement\.workspaceId\s*===\s*selected\.workspaceId/);
  assert.match(app, /id: JSON\.stringify\(\[/);
  assert.match(app, /payoutId: p\.id/);
  assert.match(app, /agreementId: p\.agreement\.id/);
  assert.match(app, /agreementKey: agreementIdentityKey\(p\.agreement\)/);
  assert.match(app, /These payout details apply to/);
  assert.doesNotMatch(
    app,
    /label="Workspace name"|Payment accounts are scoped to a workspace/,
  );
});

test("money labels distinguish allocation from payout completion", () => {
  const payments = readFileSync(
    new URL(
      "../components/sections/agreement-tabs/payments-tab.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const workspace = readFileSync(
    new URL("../components/agreement-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(payments, /ALLOCATED: "Split"/);
  assert.doesNotMatch(payments, /ALLOCATED: "Paid and split"/);
  assert.match(workspace, /Advance allocation/);
  assert.match(workspace, /allocated toward the advance/);
});

test("allocation explanation does not invent an advance for a zero-net payment", () => {
  const source = readFileSync(
    new URL("../components/allocation-calculation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /trace\.recoupedCents > 0/);
  assert.match(source, /No money remained to split after processing fees/);
  assert.match(source, /trace\.advanceSource && \(\s*<tr>/);
});
