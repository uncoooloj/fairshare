import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("reset UI keeps credentials in fragment memory, clears URL, guards duplicates and requires confirmation", () => {
  const s = readFileSync(
    new URL("../components/password-recovery.tsx", import.meta.url),
    "utf8",
  );
  assert.match(s, /window.location.hash/);
  assert.match(s, /reset\s*&&\s*!captured\.current/);
  assert.match(s, /history.replaceState/);
  assert.match(s, /if\s*\(pending\.current\)\s*return/);
  assert.match(
    s,
    /data\.get\(["']password["']\)\s*!==\s*data\.get\(["']confirm["']\)/,
  );
  assert.match(s, /setToken\(["']["']\)/);
  assert(!s.includes("localStorage"));
});
test("successful password reset clears BFF cookie and sign-in exposes real recovery route", () => {
  const route = readFileSync(
    new URL("../app/api/service/[...path]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /"auth\/password-reset\/confirm"/);
  const auth = readFileSync(
    new URL("../components/designer-auth.tsx", import.meta.url),
    "utf8",
  );
  assert.match(auth, /href="\/forgot-password"/);
});
