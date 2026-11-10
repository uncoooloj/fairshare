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
  assert.match(app, /workspaces.length > 1 \? <select/);
  assert.match(app, /workspaces\[0\]\?\.name \|\| "No workspace yet"/);
});
test("account settings and invitations remain accessible before workspace creation", () => {
  assert.match(app, /!workspace && section !== Section.Settings \? \(/);
  assert.match(app, /<WorkspaceOnboarding section=\{section\}/);
});
test("successful creation selects server-returned workspace without a fallible second list request", () => {
  const creation = app.slice(
    app.indexOf("<WorkspaceOnboarding"),
    app.indexOf("{section === Section.Overview"),
  );
  assert.match(
    creation,
    /const result = await api\("workspaces", "POST", \{ name \}\)/,
  );
  assert.match(creation, /setWorkspace\(result.workspace.id\)/);
  assert.doesNotMatch(creation, /await loadWorkspaces/);
});
test("workspace creation locks synchronously until submission settles", () => {
  assert.match(onboarding, /busy \|\| submitting.current \|\| !name.trim\(\)/);
  assert.match(
    onboarding,
    /submitting.current = true;[\s\S]*await onCreate\(name.trim\(\)\);[\s\S]*finally \{ submitting.current = false; setCreating\(false\); \}/,
  );
});
test("first-run sections explain their own empty state and prioritize real creation over examples", () => {
  assert.match(
    onboarding,
    /section === "Agreements" \? "Your agreements start here"/,
  );
  assert.match(onboarding, /section === "Payouts" \? "No payouts yet"/);
  assert.ok(
    onboarding.indexOf("<form className={styles.setup}") <
      onboarding.indexOf("<details className={styles.explainer}"),
  );
  assert.match(onboarding, /<summary>How Fairshare works<\/summary>/);
  assert.doesNotMatch(onboarding, /Example: \$3,000 payment/);
});
