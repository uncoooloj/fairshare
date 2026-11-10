import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/designer-auth.tsx", import.meta.url),
  "utf8",
);

test("designer auth retains real login/register payloads and registration password policy", () => {
  assert.match(
    source,
    /onSubmit\(\s*login\s*\?\s*"login"\s*:\s*"register",\s*Object\.fromEntries\(\s*new FormData/,
  );
  for (const name of ["email", "password", "name"])
    assert.ok(source.includes(`name="${name}"`));
  assert.ok(source.includes("minLength={login ? 1 : 12}"));
  assert.match(source, /if\s*\(\s*busy\s*\)\s*return;/);
  assert.ok(source.includes('role="alert"'));
});
test("onboarding never claims provider success or adds unsupported OAuth links", () => {
  assert.ok(source.includes("Illustrative amounts, not account activity."));
  assert.match(
    source,
    /It does not approve an agreement\s+or\s+change anyone’s share\./,
  );
  assert.match(source, /if\s*\(\s*!busy\s*&&\s*name\.trim\(\)\s*\)\s*onCreate\(\s*name\.trim\(\)\s*\)/);
  assert.match(source, /if\s*\(\s*!busy\s*\)\s*onContinue\(\s*\)/);
  assert.doesNotMatch(
    source,
    /href=.*(?:google|microsoft)|setTimeout|localStorage|Payment successful|Email verified/,
  );
});
