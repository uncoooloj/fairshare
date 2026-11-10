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
    /onSubmit\(login \? "login" : "register", prepared\.data\)/,
  );
  for (const name of ["email", "password", "name"])
    assert.match(source, new RegExp(`name="${name}"`));
  assert.match(source, /minLength=\{login \? 1 : 12\}/);
  assert.match(source, /if \(busy\) return;/);
  assert.match(source, /role="alert"/);
});
test("onboarding never claims provider success or adds unsupported OAuth links", () => {
  assert.doesNotMatch(source, /Example: \$3,000 payment/);
  assert.match(
    source,
    /It does not approve an agreement\s+or change anyone’s share\./,
  );
  assert.match(
    source,
    /if \(busy \|\| submitting\.current \|\| !name\.trim\(\)\) return;/,
  );
  assert.match(source, /submitting\.current = true;/);
  assert.match(source, /await onCreate\(name\.trim\(\)\)/);
  assert.match(
    source,
    /finally\s*\{\s*submitting\.current = false;\s*setCreating\(false\);\s*\}/,
  );
  assert.match(source, /if \(!busy\) onContinue\(\)/);
  assert.doesNotMatch(
    source,
    /href=.*(?:google|microsoft)|setTimeout|localStorage|Payment successful|Email verified/,
  );
});
