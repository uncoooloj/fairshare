import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";
const component = (name: string) =>
  readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");

test("client-side session and section changes update the document title", () => {
  const app = appSource();
  assert.match(
    app,
    /document.title = user\s*\? `\$\{section\} · Fairshare`\s*: "Log in · Fairshare"/,
  );
  assert.match(app, /\[ready, user, section\]/);
});

test("first-run payouts is an empty state, not the agreement creation form", () => {
  const app = appSource();
  const payoutsBranch = app.slice(
    app.indexOf("section === Section.Payouts ? ("),
    app.indexOf(
      "<AgreementIntake",
      app.indexOf("section === Section.Payouts ? ("),
    ),
  );
  assert.match(payoutsBranch, /No payouts yet/);
  assert.match(payoutsBranch, /navigate\(Section.Agreements\)/);
  assert.match(payoutsBranch, /\) : \(/);
  assert.doesNotMatch(
    payoutsBranch,
    /<AgreementIntake|<AgreementCreationWizard/,
  );
});

test("login does not promise simulated MFA and settings wait for account capabilities", () => {
  assert.doesNotMatch(
    component("designer-auth"),
    /any nonempty value|hackathon MFA simulation/,
  );
  const settings = component("mfa-settings");
  assert.match(settings, /status && !status.simulated/);
  assert.match(settings, /Set up simulated step/);
  assert.match(settings, /Disable simulated step and sign out/);
  assert.match(settings, /It does not add account protection/);
  assert.match(
    settings,
    /pattern=\{status.simulated \? undefined : "\[0-9\]\{6\}"\}/,
  );
});
