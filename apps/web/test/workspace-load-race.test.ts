import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../components/fairshare-app.tsx", import.meta.url),
  "utf8",
);

test("workspace changes fence in-flight reads and clear workspace-scoped state", () => {
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
    'setInviteLink("")',
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
  assert.equal(
    (workspace.match(/request !== workspaceRequest\.current/g) || []).length,
    3,
  );

  const agreement = source
    .split("async function openAgreement(a: Agreement) {")[1]
    .split("async function refresh")[0];
  assert.match(
    agreement,
    /if \(a\.workspaceId !== currentWorkspace\.current\) return/,
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
  assert.match(
    source,
    /function navigate\(s: Section\) \{\s*if \(!mayLeaveDraft\(\)\) return;\s*openRequest\.current\+\+/,
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
    "first-workspace intake commits the live workspace before applying its result",
  );

  const session = source
    .split("function clearSession() {")[1]
    .split("function mayLeaveDraft")[0];
  assert.match(session, /commitWorkspace\(""\)/);
  assert.match(session, /setWorkspaces\(\[\]\)/);
  assert.match(session, /setUser\(null\)/);
  assert.equal(
    (source.match(/clearSession\(\)/g) || []).length,
    4,
    "logout, password, and MFA flows all clear the workspace generation",
  );
});
