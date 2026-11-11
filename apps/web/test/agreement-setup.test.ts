import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/agreement-setup.tsx", import.meta.url),
  "utf8",
);
test("setup does not guess completion or mutate financial state", () => {
  assert.match(
    source,
    /if\s*\(\s*agreement\.value\.activeVersionId\s*\)\s*return null/,
  );
  // Once a split is sent, the header status line takes over from the banner.
  assert.match(
    source,
    /if\s*\(\s*agreement\.value\.versions\.length\s*\)\s*return null/,
  );
  assert.match(
    source,
    /if\s*\(\s*!busy\s*&&\s*name\.trim\(\)\s*\)\s*onCreate\(\s*name\.trim\(\)\s*\)/,
  );
  assert.doesNotMatch(source, /fetch\(|api\(|\/activate|\/payments|\/payouts/);
});
test("setup says plainly that the split switches on when everyone approves", () => {
  assert.match(
    source,
    /When the last person approves, payments split automatically/,
  );
  assert.match(source, /No money moves yet/);
  assert.match(source, /Invite everyone who gets a share/);
  assert.doesNotMatch(
    source,
    /organizer activates|Agree on the rules first|Set up terms/,
  );
});
