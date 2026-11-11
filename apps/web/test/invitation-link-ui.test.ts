import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("private invitation actions reject same-tick duplicate creation and release lock after errors", () => {
  const source = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  ).split("function PrivateInvitation(")[1];
  assert.match(source, /const pending = useRef\(false\)/);
  assert.match(
    source,
    /if \(pending.current\) return;\s*pending.current = true;/,
  );
  assert.match(
    source,
    /finally\s*\{\s*pending\.current\s*=\s*false;\s*setBusy\(false\);/,
  );
  assert.match(source, /Anyone holding this private link/);
  assert.match(source, /No\s+email is sent/);
});

test("acceptance adopts the returned workspace and consumes the link before background loading", () => {
  const source = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  const accept = source
    .split("async function acceptInvitation(token: string) {")[1]
    .split("async function loadWorkspace")[0];
  assert.match(accept, /setWorkspace\(result.workspace.id\)/);
  assert.match(accept, /setSelected\(null\)/);
  assert.match(accept, /setAgreements\(\[\]\)/);
  assert.match(accept, /setFlowToken\(""\)/);
  assert.match(accept, /setSection\(Section.Agreements\)/);
  assert.doesNotMatch(accept, /await loadWorkspaces/);
  assert.equal((source.match(/await acceptInvitation\(/g) || []).length, 2);
});

test("refresh during sign-in retains the invitation fragment until acceptance", () => {
  const source = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  const capture = source
    .split("const token = location.hash")[1]
    .split("Promise.all")[0];
  assert.match(capture, /setFlowToken/);
  assert.doesNotMatch(capture, /history.replaceState/);
  const prompt = readFileSync(
    new URL("../components/designer-auth.tsx", import.meta.url),
    "utf8",
  );
  assert.match(prompt, /organizer must also add you\s+to\s+the\s+agreement/);
});
