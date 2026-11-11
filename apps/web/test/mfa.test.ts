import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("MFA UI uses a setup-intent switch without treating it as enabled", () => {
  const source = readFileSync(
    new URL("../components/mfa-settings.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Confirm current password/);
  assert.match(source, /"Turn on"/);
  assert.match(source, /role="switch"/);
  assert.match(source, /Finish setup to turn on/);
  assert.match(source, /status\.enabled && disableConfirmation/);
  assert.match(
    source,
    /aria-expanded=\{status\.enabled \? disableConfirmation/,
  );
  assert.match(source, /aria-controls=\{/);
  assert.match(source, /id="mfa-disable-confirmation"/);
  assert.match(source, /function closeDisableConfirmation\(\)/);
  assert.match(source, /onClick=\{closeDisableConfirmation\}/);
  assert.match(source, /pending.current\s*=\s*true/);
  assert.match(source, /auth\/mfa/);
  assert.match(source, /auth\/mfa\/cancel/);
  assert.match(source, /setSetup\(null\)/);
  assert(!source.includes("localStorage"));
  assert(!source.includes("https://"));
  assert.match(source, /You won’t see them again/);
});
test("sign-in submits optional factor and BFF clears cookie after enrollment or disable", () => {
  const auth = readFileSync(
    new URL("../components/designer-auth.tsx", import.meta.url),
    "utf8",
  );
  assert.match(auth, /name="mfaCode"/);
  const route = readFileSync(
    new URL("../app/api/service/[...path]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /auth\/mfa\/activate/);
  assert.match(route, /auth\/mfa\/disable/);
});
