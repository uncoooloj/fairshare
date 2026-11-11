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
  assert.match(panel, /Nothing yet\. Approvals and payouts show up here\./);
  assert.doesNotMatch(panel, /unreadCount|"POST"/i);
});
test("notification panel groups the live feed locally and does not invent read state", () => {
  assert.match(panel, /date\.getFullYear\(\).*now\.getFullYear\(\)/s);
  assert.match(panel, /\["today", "earlier"\]/);
  assert.match(panel, /<h3>\{group === "today" \? "Today" : "Earlier"\}<\/h3>/);
  assert.match(panel, /<NotificationIcon kind=\{event\.kind\}/);
  assert.match(panel, /className="notification-headline"/);
  assert.match(panel, /className="notification-detail"/);
  assert.match(panel, /does not persist read receipts/i);
  assert.doesNotMatch(panel, /Mark all read|unreadCount|"POST"/i);
});
test("panel has keyboard dismissal, focus restoration and refreshes on open", () => {
  assert.match(panel, /aria-expanded=\{open\}/);
  assert.match(panel, /event.key === "Escape"/);
  assert.match(panel, /trigger.current\?\.focus\(\)/);
  assert.match(panel, /close.current\?\.focus\(\)/);
  assert.match(panel, /\}, \[open\]\);\s*useEffect/);
  assert.doesNotMatch(panel, /Refresh updates|setRefresh/);
});
test("panel header is a gear and a ×, and each row opens its agreement", () => {
  assert.match(
    panel,
    /<CloseButton\s+ref=\{close\}\s+label="Close notifications"/,
  );
  assert.match(panel, /aria-label="Notification settings"/);
  assert.match(panel, /role="tooltip"/);
  assert.match(panel, /<GearIcon \/>/);
  assert.doesNotMatch(panel, />\s*(Close|Preferences|View agreement)\s*</);
  assert.match(
    panel,
    /<button\s+type="button"\s+className="notification-row"\s+onClick/,
  );
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
    /onOpenAgreement\(\s*event.workspaceId,\s*event.agreementId,?\s*\)/,
  );
  assert.match(panel, /no longer have access to this agreement/);
});
