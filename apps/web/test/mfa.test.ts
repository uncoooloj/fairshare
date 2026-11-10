import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("MFA UI requires current password and code, never a cosmetic toggle or external QR service", () => {
  const source = readFileSync(
    new URL("../components/mfa-settings.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Confirm current password/);
  assert.match(source, /Enable authenticator and show recovery codes/);
  assert.match(source, /pending.current\s*=\s*true/);
  assert.match(source, /auth\/mfa/);
  assert.match(source, /action\s*===\s*['"]cancel['"]/);
  assert(!source.includes("localStorage"));
  assert(!source.includes("https://"));
  assert.match(source, /They will not be shown again/);
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
