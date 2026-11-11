import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";

const source = appSource();

test("workspace changes fence in-flight reads and clear workspace-scoped state", () => {
  assert.equal((source.match(/setWorkspace\(/g) || []).length, 1);
  const commit = source
    .split("function commitWorkspace(id: string) {")[1]
    .split("async function run")[0];
  assert.match(commit, /workspaceRequest\.current\+\+/);
  assert.match(commit, /currentWorkspace\.current = id/);
  for (const state of [
    "setSelected(null)",
    "setAgreements([])",
    "setMembers([])",
    "setPayments([])",
    "setPayouts([])",
    "setPayoutsComplete(false)",
    'setInviteLink("")',
    "setDraftDirty(false)",
  ])
    assert.ok(
      commit.includes(state),
      `${state} is cleared before the new load`,
    );

  const workspaces = source
    .split("async function loadWorkspaces() {")[1]
    .split("async function loadWorkspace")[0];
  assert.match(workspaces, /const request = workspaceRequest\.current/);
  assert.match(
    workspaces,
    /if \(request !== workspaceRequest\.current\) return ""/,
  );
  assert.match(
    workspaces,
    /if \(id !== currentWorkspace\.current\) commitWorkspace\(id\)/,
  );
  assert.match(
    workspaces,
    /catch \(error\) \{\s*if \(request !== workspaceRequest\.current\) return ""/,
  );

  const workspace = source
    .split("async function loadWorkspace(id: string) {")[1]
    .split("async function openAgreement")[0];
  assert.match(
    workspace,
    /const isCurrent = \(\) =>\s*request === workspaceRequest\.current && currentWorkspace\.current === id/,
  );
  assert.equal(
    (workspace.match(/if \(!isCurrent\(\)\) return/g) || []).length,
    4,
  );

  const agreement = source
    .split("async function openAgreement(a: Agreement) {")[1]
    .split("async function refresh")[0];
  assert.match(
    agreement,
    /if \(a\.workspaceId !== currentWorkspace\.current\)\s*commitWorkspace\(a\.workspaceId\)/,
  );
  assert.match(agreement, /const request = \+\+openRequest\.current/);
  assert.equal(
    (agreement.match(/request !== openRequest\.current/g) || []).length,
    3,
  );
  assert.match(
    agreement,
    /catch \(error\) \{\s*if \(request !== openRequest\.current\) return/,
  );
  assert.ok(
    source.includes(
      "function navigate(s: Section) {\n    if (!mayLeaveDraft()) return false;\n    openRequest.current++;",
    ),
  );

  const refresh = source
    .split("async function refresh() {")[1]
    .split("useEffect(() => {")[0];
  assert.match(refresh, /const id = currentWorkspace\.current/);
  assert.equal(
    (refresh.match(/workspaceRequestId !== workspaceRequest\.current/g) || [])
      .length,
    4,
  );
  assert.match(
    refresh,
    /catch \(error\) \{\s*if \(\s*workspaceRequestId !== workspaceRequest\.current/,
  );

  const mutate = source
    .split("async function mutate(action: string")[1]
    .split("if (!ready)")[0];
  assert.match(
    mutate,
    /if \(selected\?\.workspaceId !== currentWorkspace\.current\) return/,
  );
  assert.ok(
    (mutate.match(/workspaceRequestId !== workspaceRequest\.current/g) || [])
      .length >= 3,
  );

  const intake = source
    .split("async function createFromAgreement")[1]
    .split("async function refresh")[0];
  assert.match(intake, /commitWorkspace\(result\.workspace\.id\)/);
  assert.ok(
    intake.indexOf("commitWorkspace(result.workspace.id)") <
      intake.indexOf("setSelected(result.agreement)"),
  );
  assert.match(
    intake,
    /const intakeWorkspaceRequest = workspaceRequest\.current/,
  );
  assert.equal(
    (
      intake.match(/intakeWorkspaceRequest !== workspaceRequest\.current/g) ||
      []
    ).length,
    2,
    "a deferred intake member refresh cannot update members after a workspace switch",
  );
  assert.equal(
    (intake.match(/currentWorkspace\.current !== intakeWorkspaceId/g) || [])
      .length,
    2,
    "both successful and failed deferred member refreshes stay with the intake workspace",
  );

  const session = source
    .split("function clearSession() {")[1]
    .split("function mayLeaveDraft")[0];
  assert.match(session, /commitWorkspace\(""\)/);
  assert.match(session, /setWorkspaces\(\[\]\)/);
  assert.match(session, /setUser\(null\)/);
  assert.equal((source.match(/clearSession\(\)/g) || []).length, 4);
});

test("an old-render refresh cannot adopt the newly selected workspace", () => {
  assert.match(
    source,
    /async function refresh\(\)\s*\{[\s\S]*?if \(workspace !== currentWorkspace\.current\) return;/,
  );
});

test("delayed payout loads cannot overwrite or clear a newer workspace", () => {
  const workspace = source
    .split("async function loadWorkspace(id: string) {")[1]
    .split("async function openAgreement")[0];
  const afterWorkspaceRead = workspace.indexOf(
    "setAgreements(visibleAgreements)",
  );
  const clear = workspace.indexOf("setPayouts([])", afterWorkspaceRead);
  const successGuard = workspace.indexOf("if (!isCurrent()) return", clear);
  const success = workspace.indexOf("setPayouts(all.flat())", successGuard);
  const failedGuard = workspace.indexOf(
    "if (!isCurrent()) return",
    success + 1,
  );
  const failure = workspace.indexOf("setPayouts([])", failedGuard);
  assert.ok(
    clear > afterWorkspaceRead,
    "only the current workspace clears payouts",
  );
  assert.ok(successGuard > clear && success > successGuard);
  assert.ok(failedGuard > success && failure > failedGuard);
  assert.match(workspace, /setPayoutsComplete\(false\)/);
  assert.match(workspace, /setPayoutsComplete\(true\)/);
});
