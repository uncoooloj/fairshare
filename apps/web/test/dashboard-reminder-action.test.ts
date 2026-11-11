import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = (name: string) =>
  readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");

test("dashboard reminders open the selected agreement's People tab", () => {
  const dashboard = component("overview-dashboard.tsx");
  const section = component("sections/overview-section.tsx");

  assert.match(dashboard, /onSendReminder: \(agreement: Agreement\) => void/);
  assert.match(
    dashboard,
    /sendReminder\s*\? onSendReminder\(item\.agreement\)\s*:\s*onOpen\(item\.agreement\)/,
  );
  assert.match(
    dashboard,
    /sendReminder \? "Send reminder" : actionLabel\[kind\]/,
  );
  assert.match(section, /openAgreement\(a, AgreementTab\.People\)/);
  assert.doesNotMatch(section, /View all agreements/);
});

test("only organizers get the dashboard reminder action", () => {
  const dashboard = component("overview-dashboard.tsx");

  assert.match(dashboard, /item\.key\.endsWith\(":waiting"\)/);
  assert.match(
    dashboard,
    /member\.userId === userId && member\.role === "ORGANIZER"/,
  );
});

test("the agreement Nudge status action goes to People instead of opening a drawer", () => {
  const detail = component("sections/agreement-detail.tsx");
  const header = component("agreement-workspace.tsx");
  const people = component("agreement-people.tsx");

  assert.match(
    detail,
    /action === StageAction\.Nudge\)\s*changeAgreementTab\(AgreementTab\.People\)/,
  );
  assert.doesNotMatch(header, /setNudging|<NudgeDrawer/);
  assert.match(
    people,
    /mode=\{needsReminder \? ShareMode\.Nudge : ShareMode\.Link\}/,
  );
  assert.match(people, /organizer &&[\s\S]*member\.userId !== userId/);
});
