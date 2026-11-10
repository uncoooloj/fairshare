import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/designer-auth.tsx", import.meta.url),
  "utf8",
);

test("designer auth retains real login/register payloads and registration password policy", () => {
  assert.ok(
    source.includes('onSubmit(login ? "login" : "register", prepared.data)'),
  );
  for (const name of ["email", "password", "name"])
    assert.ok(source.includes(`name="${name}"`));
  assert.ok(source.includes("minLength={login ? 1 : 12}"));
  assert.ok(source.includes("if (busy) return;"));
  assert.ok(source.includes('role="alert"'));
});
test("onboarding never claims provider success or adds unsupported OAuth links", () => {
  assert.doesNotMatch(source, /Example: \$3,000 payment/);
  assert.match(
    source,
    /It does not approve an agreement\s+or\s+change anyone’s share\./,
  );
  assert.match(
    source,
    /if\s*\(\s*busy\s*\|\|\s*submitting\.current\s*\|\|\s*!name\.trim\(\)\s*\)\s*return;/,
  );
  assert.ok(source.includes("submitting.current = true;"));
  assert.ok(source.includes("await onCreate(name.trim())"));
  assert.match(
    source,
    /finally\s*\{\s*submitting\.current\s*=\s*false;\s*setCreating\(false\);\s*\}/,
  );
  assert.match(source, /if\s*\(\s*!busy\s*\)\s*onContinue\(\s*\)/);
  assert.doesNotMatch(
    source,
    /href=.*(?:google|microsoft)|setTimeout|localStorage|Payment successful|Email verified/,
  );
});
