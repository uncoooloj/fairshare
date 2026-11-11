import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Agreement, Version } from "../lib/model";
import {
  CollaboratorStage,
  CollaboratorTerms,
  collaboratorStage,
  collaboratorSummary,
  exampleLine,
} from "../components/collaborator-review";
import {
  SomethingWrongDrawer,
  WrongPart,
  changeRequestReason,
} from "../components/something-wrong-drawer";

const source = {
  origin: "SOURCE_CLAUSE",
  documentId: "d",
  clause: "",
  excerpt: "",
};
function version(over: Partial<Version> = {}): Version {
  return {
    id: 1,
    status: "AWAITING_APPROVAL",
    approvals: { maya: "2026-11-01T00:00:00.000Z" },
    changeRequests: [],
    rules: {
      currency: "USD",
      shares: [
        { userId: "maya", basisPoints: 5000 },
        { userId: "jordan", basisPoints: 3000 },
        { userId: "riley", basisPoints: 2000 },
      ],
      feePolicy: "BEFORE_SPLIT",
      advance: {
        id: "adv",
        recipientId: "maya",
        amountCents: 200000,
        verified: true,
        source,
      },
      source,
      unresolvedQuestions: [],
    },
    ...over,
  };
}
function agreement(v: Version, recouped = 0): Agreement {
  return {
    workspaceId: "w",
    id: "a",
    revision: 3,
    value: {
      name: "Midnight Sessions",
      members: [
        { userId: "maya", displayName: "Maya Okafor", role: "ORGANIZER" },
        { userId: "jordan", displayName: "Jordan Reyes", role: "COLLABORATOR" },
        { userId: "riley", displayName: "Riley Chen", role: "COLLABORATOR" },
      ],
      versions: [v],
      revenue: [],
      recoupedByAdvance: recouped ? { adv: recouped } : {},
      reviewHold: false,
      audit: [],
    },
  };
}

test("what you get: share after the advance, in plain words", () => {
  const v = version();
  const s = collaboratorSummary(agreement(v), v, "riley");
  assert.equal(s.headline, "You get 20% after Maya’s $2,000 is paid back.");
  assert.equal(s.organizerName, "Maya");
  assert.deepEqual(s.waitingOn, ["Jordan"]);
  assert.ok(
    s.sentences.includes(
      "After that, every payment is split: Maya 50%, Jordan 30%, you 20%.",
    ),
  );
  assert.ok(s.sentences.includes("Nothing is paid until everyone approves."));
  assert.ok(
    s.sentences.includes("Payment fees come off the top, before the split."),
  );
  const banned =
    /allocation|recoup|provenance|basis points|version|activate|reconcile|capture/i;
  for (const line of [s.headline, ...s.sentences])
    assert.doesNotMatch(line, banned);
  assert.equal(exampleLine(20000), "On a $3,000 payment, that’s $200.");
});

test("headline covers paid-back, own and fee-bearer cases", () => {
  const v = version();
  assert.equal(
    collaboratorSummary(agreement(v, 200000), v, "riley").headline,
    "You get 20% of every payment.",
  );
  assert.equal(
    collaboratorSummary(agreement(v, 50000), v, "riley").headline,
    "You get 20% after Maya’s $1,500 is paid back.",
  );
  assert.equal(
    collaboratorSummary(agreement(v), v, "maya").headline,
    "You get your $2,000 back first, then 50% of every payment.",
  );
  const fees = version({
    rules: { ...v.rules, feePolicy: "ORGANIZER_SHARE", feeBearerId: "maya" },
  });
  assert.ok(
    collaboratorSummary(agreement(fees), fees, "riley").sentences.includes(
      "Payment fees come out of Maya’s share.",
    ),
  );
});

test("stage follows the latest terms and this person's approval", () => {
  const v = version();
  assert.equal(
    collaboratorStage(agreement(v), v, "riley"),
    CollaboratorStage.REVIEW,
  );
  assert.equal(
    collaboratorStage(agreement(v), v, "maya"),
    CollaboratorStage.WAITING,
  );
  const active = version({ status: "ACTIVE" });
  assert.equal(
    collaboratorStage(agreement(active), active, "riley"),
    CollaboratorStage.ALL_SET,
  );
  const draft = version({
    status: "DRAFT",
    approvals: {},
    changeRequests: [{ userId: "riley", reason: "Revenue split: no", at: "" }],
  });
  assert.equal(
    collaboratorStage(agreement(draft), draft, "riley"),
    CollaboratorStage.UPDATING,
  );
  const fresh = version({ status: "DRAFT", approvals: {} });
  assert.equal(
    collaboratorStage(agreement(fresh), fresh, "riley"),
    CollaboratorStage.NOT_SENT,
  );
  assert.equal(
    collaboratorStage(agreement(fresh), undefined, "riley"),
    CollaboratorStage.NOT_SENT,
  );
});

const noop = async () => {};
const termsProps = (v: Version, userId: string) => ({
  agreement: agreement(v),
  version: v,
  userId,
  base: "workspaces/w/collaborations/a",
  busy: false,
  justApproved: false,
  onApprove: noop,
  onRequestChange: noop,
  onOpenDocument: () => {},
  onPayoutDone: () => {},
});

test("review shows the decision bar only while this person must decide", () => {
  const v = version();
  const html = renderToStaticMarkup(
    createElement(CollaboratorTerms, termsProps(v, "riley")),
  );
  assert.match(html, /You get 20% after Maya’s \$2,000 is paid back\./);
  assert.match(html, /See the full agreement/);
  assert.match(html, /role="img" aria-label="Split: Maya Okafor 50%/);
  assert.match(html, />Approve</);
  assert.match(html, /Something’s not right/);
  assert.doesNotMatch(html, /Propose revised terms|Send for/);
  const waiting = renderToStaticMarkup(
    createElement(CollaboratorTerms, termsProps(v, "maya")),
  );
  assert.match(waiting, /You approved\. Waiting for Jordan and Riley\./);
  assert.doesNotMatch(waiting, />Approve</);
  const active = version({ status: "ACTIVE" });
  assert.match(
    renderToStaticMarkup(
      createElement(CollaboratorTerms, termsProps(active, "riley")),
    ),
    /All set\. Payments will split automatically\./,
  );
  const paid = renderToStaticMarkup(
    createElement(CollaboratorTerms, {
      ...termsProps(v, "riley"),
      justApproved: true,
    }),
  );
  assert.match(paid, /Where should we send your share\?/);
  assert.match(paid, /Do this later/);
});

test("something's not right: choices map to the existing change topics; note required", () => {
  assert.equal(
    changeRequestReason(WrongPart.SPLIT, " I agreed to 25% "),
    "Revenue split: I agreed to 25%",
  );
  assert.equal(
    changeRequestReason(WrongPart.ADVANCE, "It was $1,500"),
    "Advance and recoupment: It was $1,500",
  );
  assert.equal(
    changeRequestReason(WrongPart.FEES, "x"),
    "Fees and net revenue: x",
  );
  assert.equal(changeRequestReason(WrongPart.REFUNDS, "x"), "Refunds: x");
  assert.equal(changeRequestReason(WrongPart.OTHER, "x"), "x");
  assert.throws(() => changeRequestReason(WrongPart.SPLIT, "  "));
  const html = renderToStaticMarkup(
    createElement(SomethingWrongDrawer, {
      organizerName: "Maya",
      busy: false,
      onSend: noop,
      onClose: () => {},
    }),
  );
  assert.match(html, /role="dialog" aria-modal="true"/);
  for (const label of ["Split", "Advance", "Fees", "Refunds", "Something else"])
    assert.match(html, new RegExp(`<span>${label}</span>`));
  assert.match(html, /\(required\)/);
  assert.match(html, /<textarea[^>]*required/);
});

test("terms tab hides organizer controls from collaborators", () => {
  const tab = readFileSync(
    new URL(
      "../components/sections/agreement-tabs/terms-tab.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const collaborator = tab.slice(
    tab.indexOf("if (!isOrganizer)"),
    tab.indexOf("Terms everyone can understand"),
  );
  assert.match(collaborator, /<CollaboratorReviewCard/);
  assert.doesNotMatch(
    collaborator,
    /Propose revised terms|ContractReviewPanel|setEditing/,
  );
  const card = tab.slice(
    tab.indexOf("export function CollaboratorReviewCard"),
    tab.indexOf("export function AgreementTermsTab"),
  );
  assert.match(card, /<CollaboratorTerms/);
  assert.match(card, /\/versions\/\$\{latest\.id\}\/approve/);
  assert.match(card, /\/versions\/\$\{latest\.id\}\/request-change/);
});

test("a pending review comes first; the full agreement has a way back", () => {
  const detail = readFileSync(
    new URL("../components/sections/agreement-detail.tsx", import.meta.url),
    "utf8",
  );
  // The review renders before the agreement header while it is pending.
  assert.ok(
    detail.indexOf("<CollaboratorReviewCard") <
      detail.indexOf("<AgreementHeader"),
  );
  assert.match(detail, /CollaboratorStage\.REVIEW/);
  // Browser Back and Forward use a scoped marker, with a persistent listener.
  assert.match(detail, /fullAgreementHistoryState/);
  assert.match(detail, /isFullAgreementHistoryState/);
  assert.match(detail, /addEventListener\("popstate"/);
  assert.match(detail, /window\.history\.back\(\)/);
  assert.match(detail, /Back to what you get/);
});

test("on phones the decision bar is pinned above the safe area", () => {
  const css = readFileSync(
    new URL("../app/collaborator.css", import.meta.url),
    "utf8",
  );
  const phone = css.slice(css.indexOf("@media (max-width: 640px)"));
  assert.match(phone, /\.collab-footer \{[^}]*position: fixed/);
  assert.match(phone, /env\(safe-area-inset-bottom/);
  assert.match(phone, /body:has\(\.collab-footer\) \{[^}]*padding-bottom/);
});
