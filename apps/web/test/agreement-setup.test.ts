import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/agreement-setup.tsx", import.meta.url),
  "utf8",
);
test("setup does not guess completion or mutate financial state", () => {
  assert.match(source, /if\(agreement.value.activeVersionId\) return null/);
  assert.match(source, /latest.approvals\[m.userId\]/);
  assert.match(
    source,
    /if \(!busy && name.trim\(\)\) onCreate\(name.trim\(\)\)/,
  );
  assert.doesNotMatch(source, /fetch\(|api\(|\/activate|\/payments|\/payouts/);
});
test("setup explains explicit activation and sandbox rather than promising live movement", () => {
  assert.match(source, /organizer activates it/);
  assert.match(source, /does not move money/);
  assert.match(source, /accepted members before proposing/);
});
