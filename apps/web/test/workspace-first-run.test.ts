import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(
  new URL("../components/fairshare-app.tsx", import.meta.url),
  "utf8",
);
const onboarding = readFileSync(
  new URL("../components/designer-auth.tsx", import.meta.url),
  "utf8",
);

test("workspace selector only offers switching when there is a choice", () => {
  assert.match(app, /workspaces\.length\s*>\s*1\s*\?\s*\(\s*<select/);
  assert.match(app, /workspaces\[0\]\?\.name\s*\|\|\s*"No workspace yet"/);
});
test("account settings and invitations remain accessible before workspace creation", () => {
  assert.match(
    app,
    /!workspace\s*&&\s*section\s*!==\s*Section\.Settings\s*\?\s*\(/,
  );
  assert.match(app, /<WorkspaceOnboarding\s+section=\{section\}/);
});
test("successful creation selects server-returned workspace without a fallible second list request", () => {
  const creation = app.slice(
    app.indexOf("<WorkspaceOnboarding"),
    app.indexOf("{section === Section.Overview"),
  );
  assert.match(
    creation,
    /const result\s*=\s*await api\(\s*"workspaces",\s*"POST",\s*\{\s*name\s*\}\s*\)/,
  );
  assert.match(creation, /commitWorkspace\(result.workspace.id\)/);
  assert.doesNotMatch(creation, /await loadWorkspaces/);
});
test("workspace creation locks synchronously until submission settles", () => {
  assert.match(
    onboarding,
    /busy\s*\|\|\s*submitting\.current\s*\|\|\s*!name\.trim\(\)/,
  );
  assert.match(
    onboarding,
    /submitting\.current\s*=\s*true;[\s\S]*await onCreate\(\s*name\.trim\(\)\s*\);[\s\S]*finally\s*\{\s*submitting\.current\s*=\s*false;\s*setCreating\(false\);\s*\}/,
  );
});
test("first-run sections explain their own empty state and prioritize real creation over examples", () => {
  assert.match(
    onboarding,
    /function workspaceOnboardingCopy\(section: string\)\s*\{\s*switch \(section\)/,
  );
  assert.match(
    onboarding,
    /case "Agreements":\s*return \{\s*title:\s*"Your agreements start here"/,
  );
  assert.match(
    onboarding,
    /case "Payouts":\s*return \{\s*title:\s*"No payouts yet"/,
  );
  assert.match(
    onboarding,
    /default:\s*return \{\s*title:\s*"Create your workspace"/,
  );
  assert.ok(
    onboarding.indexOf("<form") <
      onboarding.indexOf("<details className={styles.explainer}"),
  );
  assert.match(onboarding, /<summary>How Fairshare works<\/summary>/);
  assert.doesNotMatch(onboarding, /Example: \$3,000 payment/);
});
