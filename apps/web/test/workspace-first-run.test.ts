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
  assert.match(app, /<AgreementIntake\s+first\s+busy=\{busy\}/);
});
test("atomic creation adopts the returned workspace and document before optional refresh", () => {
  const creation = app.slice(
    app.indexOf("async function createFromAgreement"),
    app.indexOf("async function refresh"),
  );
  assert.match(creation, /api\("agreements\/intake", "POST"/);
  assert.match(creation, /setWorkspace\(result.workspace.id\)/);
  assert.match(creation, /setDocumentId\(result.document.documentId\)/);
  assert.doesNotMatch(creation, /await loadWorkspaces|await openAgreement/);
});
test("first-run payouts explains its empty state without requiring a workspace name", () => {
  const firstRun = app.slice(
    app.indexOf("!workspace && section"),
    app.indexOf("{section === Section.Overview"),
  );
  assert.match(firstRun, /No payouts yet/);
  assert.match(firstRun, /AgreementIntake\s+first/);
  assert.doesNotMatch(firstRun, /WorkspaceOnboarding|Workspace name/);
});
