import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readOnboardingStage,
  writeOnboardingStage,
  type OnboardingStage,
} from "../components/onboarding-storage";

const read = (name: string) =>
  readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");

test("first-run onboarding uses the existing profile contract before the agreement chooser", () => {
  const app = read("fairshare-app.tsx");
  assert.match(app, /if \(type === "register"\)/);
  assert.match(app, /writeOnboardingStage\(/);
  assert.match(app, /<OnboardingWelcome/);
  assert.match(app, /<OnboardingDetails/);
  assert.match(
    app,
    /api<\{ user: User \}>\("auth\/profile", "POST", \{\s+name,/,
  );
  assert.match(app, /setOnboardingForUser\("agreement"\)/);
  assert.match(
    app,
    /firstRun &&\s+\(onboardingStage === null \|\| onboardingStage === "agreement"\)/,
  );
});

test("blocked session storage preserves a user-scoped onboarding transition in memory", () => {
  const fallback = new Map<string, OnboardingStage>();
  const blocked = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("SecurityError");
    },
  };
  writeOnboardingStage(blocked, fallback, "user-a", "welcome");
  assert.equal(readOnboardingStage(blocked, fallback, "user-a"), "welcome");
  assert.equal(readOnboardingStage(blocked, fallback, "user-b"), null);
});

test("workspace readiness and skip state reset when the signed-in user changes", () => {
  const app = read("fairshare-app.tsx");
  assert.match(
    app,
    /setSkippedFirstRun\(false\);\s+setWorkspacesLoaded\(false\);\s+workspaceLoadedRequest\.current = 0;\s+if \(!user\) return;\s+workspaceRequest\.current\+\+;/,
  );
  assert.match(
    app,
    /if \(workspaceLoadedRequest\.current === request\) setWorkspacesLoaded\(true\)/,
  );
  assert.match(
    app,
    /setWorkspacesLoaded\(false\);\s+workspaceLoadedRequest\.current = 0;\s+setSkippedFirstRun\(false\);/,
  );
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
