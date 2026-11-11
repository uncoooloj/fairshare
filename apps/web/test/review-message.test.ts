import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reviewMessage } from "../lib/review-message";
test("copy text is version-specific, with optional personal note and no access tokens", () => {
  const result = reviewMessage(
    "Midnight Sessions",
    3,
    " Please check fees. ",
    "https://usefairshare.app/app?token=private#secret",
  );
  assert.match(result, /^Please check fees\./);
  assert.match(result, /version 3/);
  assert.match(result, /account added to this agreement/);
  assert.ok(result.endsWith("https://usefairshare.app/app"));
  assert.doesNotMatch(result, /private|secret/);
});
test("copy message rejects invalid URLs and overlong notes", () => {
  assert.throws(() => reviewMessage("A", 1, "", "javascript:alert(1)"));
  assert.throws(() =>
    reviewMessage("A", 1, "x".repeat(1001), "https://usefairshare.app"),
  );
});
test("send action is gated behind confirmation and success precedes sharing", () => {
  const parent = readFileSync(
    new URL("../components/contract-review-guidance.tsx", import.meta.url),
    "utf8",
  );
  const dialog = readFileSync(
    new URL("../components/send-review-confirmation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(parent, /onClick=\{\(\) => setConfirmSend\(true\)\}/);
  assert.match(dialog, /await onSend\(\)/);
  assert.match(dialog, /setSent\(true\)/);
  assert.match(dialog, /lock.current \|\| !canSend/);
  assert.match(dialog, /showModal\(\)/);
  assert.match(dialog, /No email is sent/);
  assert.doesNotMatch(dialog, /api\(|fetch\(/);
});
test("a committed review remains shareable if the optional workspace refresh fails", () => {
  const app = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    app,
    /setSelected\(a\);\s*try\s*\{\s*await loadWorkspace\(workspace\);\s*\}\s*catch\s*\{\s*setNotice\(/,
  );
  assert.match(app, /Agreement updated\. Refresh to reload the rest/);
});
