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
  assert.ok(
    source.includes(
      "It does not approve an agreement or change anyone’s share.",
    ),
  );
  assert.ok(
    source.includes("if (busy || submitting.current || !name.trim()) return;"),
  );
  assert.ok(source.includes("submitting.current = true;"));
  assert.ok(source.includes("await onCreate(name.trim())"));
  assert.ok(
    source.includes(
      "finally { submitting.current = false; setCreating(false); }",
    ),
  );
  assert.ok(source.includes("if (!busy) onContinue()"));
  assert.doesNotMatch(
    source,
    /href=.*(?:google|microsoft)|setTimeout|localStorage|Payment successful|Email verified/,
  );
});
