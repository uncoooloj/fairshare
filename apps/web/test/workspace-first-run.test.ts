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
const onboardingCopy = onboarding.slice(
  onboarding.indexOf("function workspaceOnboardingCopy"),
  onboarding.indexOf("/** Uses the existing POST /workspaces callback"),
);

test("workspace selector only offers switching when there is a choice", () => {
  assert.match(app, /workspaces\.length > 1\s*\?\s*\(\s*<select/);
  assert.match(app, /workspaces\[0\]\?\.name \|\| "No workspace yet"/);
});
test("account settings and invitations remain accessible before workspace creation", () => {
  assert.match(app, /!workspace && section !== Section.Settings \? \(/);
  assert.match(app, /<WorkspaceOnboarding\s+section=\{section\}/);
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
    /submitting\.current = true;[\s\S]*await onCreate\(name\.trim\(\)\);[\s\S]*finally\s*\{\s*submitting\.current = false;\s*setCreating\(false\);\s*\}/,
  );
});
test("first-run sections explain their own empty state and prioritize real creation over examples", () => {
  assert.match(
    onboardingCopy,
    /switch\s*\(section\)[\s\S]*case "Agreements":\s*return \{\s*title: "Your agreements start here",\s*description:\s*"Create a workspace to upload your first agreement, invite collaborators and agree how revenue is shared\."/,
  );
  assert.match(
    onboardingCopy,
    /case "Payouts":\s*return \{\s*title: "No payouts yet",\s*description:\s*"Payouts will appear here when an agreement has approved rules and recorded payments\. Start by creating your workspace\."/,
  );
  assert.match(
    onboardingCopy,
    /default:\s*return \{\s*title: "Create your workspace",\s*description:\s*"A shared home for your agreements, collaborators and payment activity\."/,
  );
  assert.ok(
    onboarding.indexOf("<form className={styles.setup}") <
      onboarding.indexOf("<details className={styles.explainer}"),
  );
  assert.match(onboarding, /<summary>How Fairshare works<\/summary>/);
  assert.doesNotMatch(onboarding, /Example: \$3,000 payment/);
});
