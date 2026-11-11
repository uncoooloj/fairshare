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
    "no real money",
  ])
    assert.ok(page.includes(copy));
  assert.ok(!page.includes("FairshareApp"));
  assert.match(page, /href="\/login"/);
  assert.match(page, /id="how-it-works"/);
  assert.match(page, /AI suggests, people decide/);
});

test("login and workspace retain the existing app and invitation entry points", () => {
  for (const route of [
    "login",
    "app/[[...path]]",
    "invitation",
    "verify-email",
  ]) {
    assert.match(read(`../app/${route}/page.tsx`), /<FairshareApp/);
  }
  const app = appSource();
  // Login and its redirects replace history entries; Back never returns to them.
  assert.match(
    app,
    /user && location\.pathname === "\/login"\)\s*router\.replace\(loginDestination\(\)\)/,
  );
  assert.match(app, /!user && isAppPath\(location\.pathname\)/);
  assert.match(app, /import \{ useRouter \} from "next\/navigation"/);
  assert.match(app, /router\.replace\("\/app"\)/);
  assert.match(app, /\? "\/login"/);
  assert.doesNotMatch(app, /router\.push\(/);
  assert.match(
    app,
    /\["\/verify-email", "\/invitation"\]\.includes\(location.pathname\)/,
  );
  // Accepting an agreement invite swaps /invitation#token=… for /app without
  // remounting the app (Next syncs it); app routing then takes over the address.
  const accept = app.slice(
    app.indexOf("async function acceptInvitation"),
    app.indexOf("async function loadWorkspace("),
  );
  assert.match(accept, /window\.history\.replaceState\(null, "", "\/app"\)/);
  assert.match(read("../components/password-recovery.tsx"), /href="\/login"/);
});
