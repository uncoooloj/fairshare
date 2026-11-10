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
  assert.match(source, /finally \{pending.current = false;setBusy\(false\);\}/);
  assert.match(source, /Anyone holding this private link/);
  assert.match(source, /No email is sent/);
});
