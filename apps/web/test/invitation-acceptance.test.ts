import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";

const source = appSource();

test("invitation acceptance adopts the committed workspace before any reload", () => {
  const accept = source
    .split("async function acceptInvitation(token: string) {")[1]
    .split("async function loadWorkspace")[0];
  assert.match(
    accept,
    /scoped \? "agreement-invitations\/accept" : "invitations\/accept"/,
  );
  assert.match(
    accept,
    /token: scoped \? token\.slice\(AGREEMENT_INVITE_PREFIX\.length\) : token/,
  );
  assert.match(accept, /commitWorkspace\(result.workspace.id\)/);
  const commit = source
    .split("function commitWorkspace(id: string) {")[1]
    .split("function clearSession")[0];
  assert.match(commit, /setSelected\(null\)/);
  assert.match(commit, /setAgreements\(\[\]\)/);
  assert.match(accept, /setFlowToken\(""\)/);
  assert.match(accept, /setSection\(Section.Agreements\)/);
  assert.doesNotMatch(accept, /await loadWorkspaces/);
  assert.equal((source.match(/await acceptInvitation\(/g) || []).length, 2);
});

test("invitation token stays in the fragment until the acceptance succeeds", () => {
  const capture = source
    .split("const token = location.hash")[1]
    .split("Promise.all")[0];
  assert.match(capture, /setFlowToken/);
  assert.doesNotMatch(capture, /history.replaceState/);
});
