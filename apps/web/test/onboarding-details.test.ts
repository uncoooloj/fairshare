import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name: string) =>
  readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");

test("first-run onboarding uses the existing profile contract before the agreement chooser", () => {
  const app = read("fairshare-app.tsx");
  assert.match(app, /fairshare:onboarding:v1:\$\{userId\}/);
  assert.match(
    app,
    /sessionStorage\.getItem\(onboardingStorageKey\(user\.id\)\)/,
  );
  assert.match(app, /<OnboardingWelcome/);
  assert.match(app, /<OnboardingDetails/);
  assert.match(
    app,
    /api<\{ user: User \}>\("auth\/profile", "POST", \{\s+name,/,
  );
  assert.match(app, /setOnboardingForUser\("agreement"\)/);
  assert.match(app, /firstRun && onboardingStage === "agreement"/);
});

test("details only save a display name and show USD as a fixed product constraint", () => {
  const details = read("onboarding-details.tsx");
  assert.match(details, /name="name"/);
  assert.match(details, /maxLength=\{80\}/);
  assert.match(details, /🇺🇸 USD – US dollar/);
  assert.match(details, /You can set a different currency per agreement\./);
  assert.doesNotMatch(
    details,
    /oauth|google|microsoft|one-time-code|\[0-9\]\{6\}/i,
  );
});
