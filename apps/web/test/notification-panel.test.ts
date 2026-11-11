import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";
const panel = readFileSync(
  new URL("../components/notification-panel.tsx", import.meta.url),
  "utf8",
);
const app = appSource();

test("notification panel uses the authenticated feed and distinguishes loading, error and empty", () => {
  assert.match(panel, /auth\/notifications/);
  assert.match(panel, /setLoading\(true\)/);
  assert.match(panel, /if \(active\) setEvents/);
  assert.match(panel, /active = false/);
  assert.match(panel, /role="alert"/);
  assert.match(panel, /No matching updates yet/);
  assert.doesNotMatch(panel, /mark.*read|unreadCount|"POST"/i);
});
test("panel has keyboard dismissal, focus restoration and actual user-triggered refresh", () => {
  assert.match(panel, /aria-expanded=\{open\}/);
  assert.match(panel, /event.key === "Escape"/);
  assert.match(panel, /trigger.current\?\.focus\(\)/);
  assert.match(panel, /close.current\?\.focus\(\)/);
  assert.match(panel, /setRefresh\(\(value\) => value \+ 1\)/);
});
test("notification navigation preserves draft guards and accounts are isolated", () => {
  const wiring = app.slice(
    app.indexOf("<NotificationPanel"),
    app.indexOf("<NotificationPanel") + 900,
  );
  assert.match(wiring, /key=\{`\$\{user.id\}:\$\{workspace\}`\}/);
  assert.match(wiring, /!agreement \|\| !mayLeaveDraft\(\)/);
  assert.match(wiring, /openAgreement\(agreement\)/);
  assert.match(wiring, /setSettingsTab\("Notifications"\)/);
  assert.match(panel, /agreement.workspaceId === event.workspaceId/);
  assert.match(panel, /agreement.id === event.agreementId/);
  assert.match(
    panel,
    /onOpenAgreement\(event.workspaceId, event.agreementId\)/,
  );
  assert.match(panel, /no longer available to your account/);
});
