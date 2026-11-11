import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  AgreementCreationWizard,
  creationSteps,
} from "../components/agreement-creation-wizard";
import { WizardStep, WizardStepper } from "../components/wizard-chrome";
import {
  detailsPayload,
  emptyDetails,
  formatDateRange,
  validateDetails,
} from "../components/wizard-details-step";
import { ReviewStep } from "../components/wizard-review-step";
import { DocumentMode } from "../components/document-step";
import { InviteeRole } from "../lib/agreement-invitations";
import { appSource } from "./app-source";

const wizard = readFileSync(
  new URL("../components/agreement-creation-wizard.tsx", import.meta.url),
  "utf8",
);
const owner = { id: "owner", name: "Maya Okafor", email: "maya@example.test" };
const noop = () => {};

test("creation runs Details → Document → People → Review with one stepper", () => {
  assert.deepEqual(creationSteps, ["Details", "Document", "People", "Review"]);
  const html = renderToStaticMarkup(
    createElement(WizardStepper, { step: WizardStep.PEOPLE }),
  );
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  assert.match(html, /New agreement progress/);
  assert.equal((html.match(/\(done\)/g) || []).length, 2);
  assert.doesNotMatch(html, /role="tab"|<button/);
});

test("the wizard is full-screen and starts on Details with a fixed USD currency", () => {
  const html = renderToStaticMarkup(
    createElement(AgreementCreationWizard, {
      owner,
      onCreate: async () => ({
        workspaceId: "w",
        agreementId: "a",
        documentId: "d",
      }),
      onFinish: noop,
      onClose: noop,
      onBusyChange: noop,
    }),
  );
  assert.match(html, /class="wiz"/);
  assert.match(html, /aria-label="Close new agreement"/);
  assert.match(html, /<h1 id="wiz-step-title" tabindex="-1">Details<\/h1>/);
  assert.match(html, /Agreement name/);
  assert.match(html, /USD · US dollar/);
  assert.match(html, /Payments and payouts are in US dollars/);
  assert.doesNotMatch(html, /<select|Coming soon|type="file"/);
  assert.match(html, /type="date"/);
  assert.match(html, /No end date/);
  // Continue stays disabled until the name is filled in; Back is absent on the first step.
  assert.match(
    html,
    /type="submit" form="wiz-form" class="button primary" disabled="">Continue/,
  );
  assert.doesNotMatch(html, />Back</);
});

test("details mirror the API rules and send null for no end date", () => {
  const details = { ...emptyDetails(), name: " Midnight Sessions " };
  assert.equal(validateDetails(details), undefined);
  assert.match(validateDetails(emptyDetails()) ?? "", /name/);
  assert.match(
    validateDetails({
      ...details,
      effectiveFrom: "2026-10-01",
      effectiveTo: "2026-09-30",
    }) ?? "",
    /before the start/,
  );
  assert.match(
    validateDetails({ ...details, effectiveFrom: "2026-02-30" }) ?? "",
    /valid start/,
  );
  const open = { ...details, effectiveFrom: "2026-10-01", noEndDate: true };
  assert.deepEqual(detailsPayload(open), {
    name: "Midnight Sessions",
    effectiveFrom: "2026-10-01",
    effectiveTo: null,
  });
  assert.deepEqual(detailsPayload(details), { name: "Midnight Sessions" });
  assert.equal(formatDateRange(open), "Oct 1, 2026 – no end date");
  assert.equal(formatDateRange(details), "Not set");
});

test("review lists every row with Edit links and the consent checkbox", () => {
  const html = renderToStaticMarkup(
    createElement(ReviewStep, {
      details: {
        ...emptyDetails(),
        name: "Midnight Sessions",
        effectiveFrom: "2026-10-01",
        noEndDate: true,
      },
      mode: DocumentMode.PASTE,
      file: null,
      text: "x".repeat(1204),
      owner,
      people: [
        {
          key: "j",
          name: "Jordan Reyes",
          email: "jordan@example.test",
          role: InviteeRole.COLLABORATOR,
        },
      ],
      consent: false,
      onConsent: noop,
      onEdit: noop,
    }),
  );
  for (const label of ["Name", "Currency", "Dates", "Document", "People"])
    assert.match(html, new RegExp(`<dt>${label}</dt>`));
  assert.match(html, /Oct 1, 2026 – no end date/);
  assert.match(html, /Pasted text · 1,204 characters/);
  assert.match(html, /Maya Okafor<\/span><small>Owner/);
  assert.match(html, /Jordan Reyes<\/span><small>Collaborator/);
  assert.equal((html.match(/>Edit</g) || []).length, 4);
  assert.match(html, /Let Fairshare read this agreement to suggest rules/);
  assert.match(html, /moves no money/);
});

test("nothing is created before Review; intake, invites, then reading", () => {
  assert.match(
    wizard,
    /if \(step === WizardStep.REVIEW\) void create\(\);\s*else go\(step \+ 1\);/,
  );
  const create = wizard.slice(wizard.indexOf("async function create()"));
  const intake = create.indexOf("await onCreate(input)");
  const invites = create.indexOf("await createInvites(");
  const reading = create.indexOf("afterInvites(made, results)");
  assert.ok(intake > 0 && invites > intake && reading > invites);
  assert.match(
    wizard,
    /consent\s*\?\s*"Create & read document"\s*:\s*"Create agreement"/,
  );
  assert.match(wizard, /readAgreement\(\{/);
  assert.doesNotMatch(wizard, /consentToCloudflare: true|fetch\(/);
});

test("retries keep one idempotency key per attempt and unreadable files go back to Document", () => {
  assert.match(wizard, /requestId\.current \|\|= crypto\.randomUUID\(\)/);
  assert.match(wizard, /function changed\(\) \{\s*requestId\.current = "";/);
  assert.match(wizard, /if \(locked\.current \|\| created\) return;/);
  assert.match(
    wizard,
    /isUnreadableDocument\(cause\)\) \{\s*requestId\.current = "";\s*setDocumentError\(message\);\s*setStep\(WizardStep\.DOCUMENT\);/,
  );
  assert.match(wizard, /role="alert"/);
  assert.match(wizard, /heading\.current\?\.focus\(\)/);
  assert.match(wizard, /Nothing has been created yet/);
});

test("finishing creation lands in Terms, opening Proposed rules only after reading", () => {
  const app = appSource();
  assert.doesNotMatch(
    app,
    /AgreementCreationWizard|creationMarker|sessionStorage/,
  );
  assert.match(app, /function finishCreation\(/);
  assert.match(app, /setTab\(AgreementTab\.Terms\)/);
  assert.match(
    app,
    /rulesLanding=\{rulesLanding === agreementIdentityKey\(selected\)\}/,
  );
  assert.match(app, /onBusyChange=\{setBusy\}/);
  assert.match(app, /function mayLeaveDraft\(\) \{\s*if \(busy\) return false/);
});
