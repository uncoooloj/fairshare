import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("public landing explains the v2 three-step story without exposing application UI", () => {
  const page = read("../app/page.tsx");
  for (const copy of [
    "Here’s how Fairshare works",
    "Upload agreement",
    "Everyone approves",
    "Payments follow the rules",
    "Illustrative split",
    "No live money",
  ])
    assert.ok(page.includes(copy));
  assert.ok(!page.includes("FairshareApp"));
  assert.match(page, /href="\/login"/);
  assert.match(page, /id="how-it-works"/);
  assert.match(page, /People approve the rules, not the AI/);
});

test("login and workspace retain the existing app and invitation entry points", () => {
  for (const route of ["login", "app", "invitation", "verify-email"]) {
    assert.match(read(`../app/${route}/page.tsx`), /<FairshareApp/);
  }
  const app = appSource();
  assert.match(app, /\["\/app", "\/login"\]\.includes\(location.pathname\)/);
  assert.match(app, /user \? "\/app" : "\/login"/);
  assert.match(
    app,
    /\["\/verify-email", "\/invitation"\]\.includes\(location.pathname\)/,
  );
  assert.ok(!app.includes('history.replaceState(null, "", "/")'));
  assert.match(read("../components/password-recovery.tsx"), /href="\/login"/);
});
