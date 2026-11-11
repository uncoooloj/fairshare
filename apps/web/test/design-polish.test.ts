import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatDay, formatExact, formatWhen } from "../lib/dates";
import { initials, toneForId, toneInRoster, PERSON_TONES } from "../lib/person";

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
  const roster = ["a", "b", "c"].map((userId) => ({ userId }));
  assert.deepEqual(
    roster.map((m) => toneInRoster(m.userId, roster)),
    [0, 1, 2],
  );
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
