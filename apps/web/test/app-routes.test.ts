import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AppHistoryMark,
  AppView,
  appPath,
  historyMark,
  isAppPath,
  markedState,
  parseAppPath,
  safeAppPath,
} from "../lib/app-routes";
import { AgreementTab, Section, type Agreement } from "../lib/model";
import { createRequire } from "node:module";
import { readComponent } from "./app-source";

// The agreements table pulls in a CSS module through shared widgets. Match the
// existing SSR harness: require.extensions stubs styles on every supported Node
// (module.register hooks do not reach tsx's CommonJS path on Node 22).
const require = createRequire(import.meta.url);
require.extensions[".css"] = () => {};
const section = async () =>
  require("../components/sections/agreements-section.tsx")
    .AgreementsSection as typeof import("../components/sections/agreements-section").AgreementsSection;

const app = readComponent("fairshare-app.tsx");
const ID = "3f1c2a9e-5b7d-4e1a-9c2b-0d8e7f6a5b4c";

test("every section and agreement tab has its own path, and deep links read back to it", () => {
  const cases: [string, ReturnType<typeof parseAppPath>][] = [
    ["/app", { view: AppView.Section, section: Section.Overview }],
    ["/app/agreements", { view: AppView.Section, section: Section.Agreements }],
    ["/app/payouts", { view: AppView.Section, section: Section.Payouts }],
    ["/app/settings", { view: AppView.Section, section: Section.Settings }],
    [
      "/app/agreements/new",
      { view: AppView.NewAgreement, section: Section.Agreements },
    ],
    [
      `/app/agreements/${ID}`,
      {
        view: AppView.Agreement,
        section: Section.Agreements,
        agreementId: ID,
        tab: AgreementTab.Overview,
      },
    ],
    [
      `/app/agreements/${ID}/payments`,
      {
        view: AppView.Agreement,
        section: Section.Agreements,
        agreementId: ID,
        tab: AgreementTab.Payments,
      },
    ],
    [
      `/app/agreements/${ID}/people`,
      {
        view: AppView.Agreement,
        section: Section.Agreements,
        agreementId: ID,
        tab: AgreementTab.People,
      },
    ],
    [
      `/app/agreements/${ID}/agreement`,
      {
        view: AppView.Agreement,
        section: Section.Agreements,
        agreementId: ID,
        tab: AgreementTab.Terms,
      },
    ],
    [
      `/app/agreements/${ID}/setup`,
      {
        view: AppView.DraftSetup,
        section: Section.Agreements,
        agreementId: ID,
      },
    ],
  ];
  for (const [path, route] of cases) {
    assert.deepEqual(parseAppPath(path), route, path);
    assert.equal(appPath(route), path, path);
    // Refresh with a trailing slash opens the same place.
    assert.deepEqual(parseAppPath(`${path}/`), route);
  }
});

test("tabs that share a screen share its URL", () => {
  const at = (tab: AgreementTab) =>
    appPath({
      view: AppView.Agreement,
      section: Section.Agreements,
      agreementId: ID,
      tab,
    });
  assert.equal(at(AgreementTab.Allocations), at(AgreementTab.Payments));
  assert.equal(at(AgreementTab.Document), at(AgreementTab.Terms));
});

test("unknown or hostile paths fall back to a safe section", () => {
  assert.equal(parseAppPath("/app/nope").section, Section.Overview);
  assert.equal(parseAppPath("/app/payouts/x").section, Section.Overview);
  assert.deepEqual(parseAppPath(`/app/agreements/${ID}/wat`), {
    view: AppView.Section,
    section: Section.Agreements,
  });
  assert.equal(
    parseAppPath("/app/agreements/%3Cscript%3E").view,
    AppView.Section,
  );
  assert.equal(safeAppPath("https://evil.example/app"), "/app");
  assert.equal(safeAppPath("//evil.example/app"), "/app");
  assert.equal(safeAppPath("/login"), "/app");
  assert.equal(safeAppPath("/app/payouts"), "/app/payouts");
  assert.equal(isAppPath("/application"), false);
  assert.equal(isAppPath("/app/settings"), true);
});

test("history entries keep framework state and carry the app marker", () => {
  const framework = { __NA: true, tree: [1] };
  const guard = markedState(framework, AppHistoryMark.Guard);
  assert.equal((guard as Record<string, unknown>).__NA, true);
  assert.equal(historyMark(guard), AppHistoryMark.Guard);
  assert.equal(historyMark(null), undefined);
  assert.equal(historyMark({ fairshareApp: "other" }), undefined);
});

test("Back never leaves the dashboard for the home or login page", () => {
  // Login and sign-up land in the app by replacing the login entry.
  assert.match(
    app,
    /user && location\.pathname === "\/login"\)\s*router\.replace\(loginDestination\(\)\)/,
  );
  assert.doesNotMatch(app, /router\.push\(/);
  // The visit's first entry becomes a guard; Back onto it steps forward again.
  assert.match(app, /markedState\(history\.state, AppHistoryMark\.Guard\)/);
  assert.match(
    app,
    /historyMark\(event\.state\) === AppHistoryMark\.Guard\) \{[\s\S]*?history\.forward\(\)/,
  );
  // Back and Forward inside the app open the address's screen.
  assert.match(app, /applyRoute\(parseAppPath\(location\.pathname\)\)/);
  // Wizard close and Sent replace the wizard's entry instead of stacking it.
  for (const fn of ["function leaveWizard", "function finishCreation"]) {
    const body = app.slice(app.indexOf(fn), app.indexOf(fn) + 500);
    assert.match(body, /replaceNext\.current = true/, fn);
  }
});

test("every New agreement entry point opens a fresh wizard", () => {
  assert.match(app, /function startNewAgreement\(\)/);
  const fresh = app.slice(
    app.indexOf("function freshWizard()"),
    app.indexOf("function startNewAgreement()"),
  );
  for (const reset of [
    "setSelected(null)",
    "setResume(null)",
    'setWizardDraftId("")',
    "setCreating(true)",
  ])
    assert.ok(fresh.includes(reset), reset);
  // Sections get the fresh-wizard setter, never the raw state setter.
  assert.doesNotMatch(app, /setCreating=\{setCreating\}/);
  assert.equal(
    (app.match(/setCreating=\{setCreatingFromSection\}/g) || []).length,
    2,
  );
  assert.doesNotMatch(app, /onClick=\{\(\) => setCreating\(true\)\}/);
});

const agreement = (
  id: string,
  name: string,
  versions: unknown[],
  organizer = "owner",
): Agreement =>
  ({
    workspaceId: "w1",
    id,
    revision: 1,
    value: {
      id,
      name,
      members: [
        { userId: organizer, displayName: "Maya Okafor", role: "ORGANIZER" },
      ],
      versions,
      audit: [],
      revenue: [],
    },
  }) as unknown as Agreement;

test("drafts are rows in the agreements table with Not sent yet and Finish setting up", async () => {
  const AgreementsSection = await section();
  const sent = agreement("sent", "Summer Sessions EP", [
    {
      id: 1,
      status: "AWAITING_APPROVAL",
      rules: { shares: [{ userId: "owner", basisPoints: 10000 }] },
      approvals: {},
    },
  ]);
  const draft = agreement("draft", "Midnight Sessions", []);
  const html = renderToStaticMarkup(
    createElement(AgreementsSection, {
      userId: "owner",
      canCreateAgreement: true,
      agreements: [sent, draft],
      workspaces: [{ id: "w1", role: "OWNER" }],
      workspace: "w1",
      setCreating: () => {},
      run: async () => {},
      openAgreement: async () => {},
    }),
  );
  const table = html.slice(html.indexOf("<table"));
  // Both in one table, the draft first.
  assert.ok(table.indexOf("Midnight Sessions") < table.indexOf("Summer"));
  assert.match(table, /status-chip neutral">Not sent yet</);
  assert.match(
    table,
    /aria-label="Finish setting up Midnight Sessions"[^>]*>Finish setting up</,
  );
  assert.equal((table.match(/Finish setting up</g) || []).length, 1);
  assert.doesNotMatch(html, /wiz-drafts/);
});

test("a draft you only joined is not yours to finish", async () => {
  const AgreementsSection = await section();
  const theirs = agreement("draft", "Their draft", [], "someone-else");
  const html = renderToStaticMarkup(
    createElement(AgreementsSection, {
      userId: "owner",
      canCreateAgreement: true,
      agreements: [theirs],
      workspaces: [],
      workspace: "w1",
      setCreating: () => {},
      run: async () => {},
      openAgreement: async () => {},
    }),
  );
  assert.doesNotMatch(html, /Finish setting up/);
  assert.match(html, /Their draft/);
});
