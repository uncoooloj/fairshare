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
  assert.match(workspaces, /if \(id !== workspace\) commitWorkspace\(id\)/);
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
  assert.match(agreement, /if \(a\.workspaceId !== workspace\) return/);
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
    /function navigate\(s: Section\) \{\s*openRequest\.current\+\+/,
  );
});
