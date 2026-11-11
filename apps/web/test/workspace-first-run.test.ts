import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";
const app = appSource();

test("navigation selects actual agreements, never hidden tenant groups", () => {
  assert.match(app, /<GlobalSearch\s+agreements=\{agreements\}/);
  assert.match(app, /openAgreement\(agreement\)/);
  assert.doesNotMatch(app, /aria-label="Workspace"|No workspace yet/);
});
test("account settings and invitations remain accessible before workspace creation", () => {
  assert.match(
    app,
    /const needsWorkspace\s*=\s*!workspace\s*&&\s*section\s*!==\s*Section\.Settings/,
  );
  assert.match(
    app,
    /isInvitationFlow\s*\?\s*null\s*:\s*needsWorkspace\s*\?\s*\(/,
  );
  assert.match(app, /<AgreementIntake\s+first=\{needsWorkspace && !creating\}/);
  assert.match(app, /const showWizard =\s*!flowToken &&/);
});
test("atomic creation adopts the returned workspace and document before optional refresh", () => {
  const creation = app.slice(
    app.indexOf("async function createFromAgreement"),
    app.indexOf("async function refresh"),
  );
  assert.match(creation, /api\(\s*"agreements\/intake",\s*"POST"/);
  assert.match(creation, /commitWorkspace\(result.workspace.id\)/);
  assert.match(creation, /void loadWorkspace\(intakeWorkspaceId\)/);
  assert.match(
    creation,
    /item\.workspaceId !== result\.agreement\.workspaceId \|\|\s*item\.id !== result\.agreement\.id/,
  );
  assert.match(creation, /documentText: result\.document\.text/);
  assert.doesNotMatch(creation, /await loadWorkspaces|await openAgreement/);
});
test("first-run payouts explains its empty state without requiring a workspace name", () => {
  const firstRun = app.slice(
    app.indexOf("{isInvitationFlow ? null : needsWorkspace"),
    app.indexOf("{section === Section.Overview"),
  );
  assert.match(firstRun, /No payouts yet/);
  assert.match(firstRun, /No agreements yet/);
  assert.match(firstRun, /setCreating\(true\)/);
  assert.doesNotMatch(firstRun, /WorkspaceOnboarding|Workspace name/);
});
