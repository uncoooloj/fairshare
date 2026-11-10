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
    /onSubmit\(login \? "login" : "register", Object\.fromEntries\(new FormData/,
  );
  for (const name of ["email", "password", "name"])
    assert.ok(source.includes(`name="${name}"`));
  assert.ok(source.includes("minLength={login ? 1 : 12}"));
  assert.ok(source.includes("if (busy) return;"));
  assert.ok(source.includes('role="alert"'));
});
test("onboarding never claims provider success or adds unsupported OAuth links", () => {
  assert.ok(source.includes("Illustrative amounts, not account activity."));
  assert.ok(
    source.includes(
      "It does not approve an agreement or change anyone’s share.",
    ),
  );
  assert.ok(source.includes("if (!busy && name.trim()) onCreate(name.trim())"));
  assert.ok(source.includes("if (!busy) onContinue()"));
  assert.doesNotMatch(
    source,
    /href=.*(?:google|microsoft)|setTimeout|localStorage|Payment successful|Email verified/,
  );
});
