import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";
test("private invitation actions reject same-tick duplicate creation and release lock after errors", () => {
  const source = appSource().split("function PrivateInvitation(")[1];
  assert.match(source, /const pending = useRef\(false\)/);
  assert.match(
    source,
    /if \(pending.current\) return;\s*pending.current = true;/,
  );
  assert.match(
    source,
    /finally\s*\{\s*pending\.current\s*=\s*false;\s*setBusy\(false\);/,
  );
  assert.match(source, /Send this link to one person/);
  assert.match(source, /It works once/);
});

test("acceptance adopts the returned workspace and consumes the link before background loading", () => {
  const source = appSource();
  const accept = source
    .split("async function acceptInvitation(token: string) {")[1]
    .split("async function loadWorkspace")[0];
  assert.match(accept, /commitWorkspace\(result.workspace.id\)/);
  const commit = source
    .split("function commitWorkspace(id: string) {")[1]
    .split("function clearSession")[0];
  assert.match(commit, /setWorkspace\(id\)/);
  assert.match(commit, /setSelected\(null\)/);
  assert.match(commit, /setAgreements\(\[\]\)/);
  assert.match(accept, /setFlowToken\(""\)/);
  assert.match(accept, /setSection\(Section.Agreements\)/);
  assert.doesNotMatch(accept, /await loadWorkspaces/);
  assert.equal((source.match(/await acceptInvitation\(/g) || []).length, 2);
});

test("refresh during sign-in retains the invitation fragment until acceptance", () => {
  const source = appSource();
  const capture = source
    .split("const token = location.hash")[1]
    .split("Promise.all")[0];
  assert.match(capture, /setFlowToken/);
  assert.doesNotMatch(capture, /history.replaceState/);
  const prompt = readFileSync(
    new URL("../components/designer-auth.tsx", import.meta.url),
    "utf8",
  );
  assert.match(prompt, /organizer adds you to the agreement/);
});
