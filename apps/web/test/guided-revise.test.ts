import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  addMember,
  addPendingMember,
  allocateConfirmedRevenue,
  approveAndSwitchOn,
  createCollaboration,
  DomainError,
  MemberRole,
  requestChange,
  RuleOrigin,
  submitForApproval,
  type Collaboration,
  type Rules as DomainRules,
} from "../../../packages/domain/src/index";
import {
  answersFromRules,
  priorAdvanceOf,
  revisableRules,
  revisedRules,
} from "../lib/answers-from-rules";
import { agreementStatus, AgreementStage } from "../lib/agreement-status";
import { Currency, type Agreement, type Rules } from "../lib/model";
import {
  AnswerSource,
  FeeChoice,
  RefundChoice,
  summarySentences,
  toRules,
  type AgreementAnswers,
} from "../lib/rules-answers";
import { feeLine } from "../components/wizard-check-step";
import { feeQuestion, StandardQuestionId } from "../lib/standard-questions";
import {
  openChangeRequests,
  parseChangeRequest,
} from "../components/change-request-drawer";
import {
  AgreementReviseWizard,
  revisedSubmissionWasCommitted,
  reviseQuestions,
} from "../components/agreement-revise-wizard";
import {
  changeRequestReason,
  WrongPart,
} from "../components/something-wrong-drawer";

const at = "2026-11-11T09:00:00.000Z";
const DOC = "Section 4.1. Jordan advanced $500 to be repaid first.";
const QUOTE = "Jordan advanced $500 to be repaid first.";

const wrap = (c: Collaboration, revision = 1): Agreement => ({
  workspaceId: "w",
  id: c.id,
  revision,
  value: c as unknown as Agreement["value"],
});

/** Maya (organizer), Jordan joined, Riley invited by email and not joined yet. */
function team(): Collaboration {
  let c = createCollaboration(
    {
      id: "c",
      name: "Midnight Sessions",
      members: [
        { userId: "maya", displayName: "Maya", role: MemberRole.ORGANIZER },
      ],
    },
    "maya",
    at,
  );
  c = addMember(c, { userId: "jordan", displayName: "Jordan" }, "maya", at);
  return addPendingMember(
    c,
    { invitationId: "inv-r", name: "Riley", email: "riley@example.test" },
    "maya",
    at,
  );
}

const source = (
  excerpt = "Agreed split.",
  origin = RuleOrigin.HUMAN_PROPOSAL,
) => ({
  origin,
  documentId: "doc1",
  clause: "4",
  excerpt,
});

function rules(over: Partial<DomainRules> = {}): Rules {
  return {
    currency: "USD",
    shares: [
      { userId: "maya", basisPoints: 5000 },
      { userId: "jordan", basisPoints: 3000 },
      { userId: "pending:inv-r", basisPoints: 2000 },
    ],
    feePolicy: "BEFORE_SPLIT",
    source: source(),
    unresolvedQuestions: [],
    ...over,
  } as Rules;
}

/** answers → rules, keeping the advance ID the way the revise wizard does. */
function again(a: AgreementAnswers, prior: Rules, documentText?: string) {
  return toRules(a, {
    documentId: prior.source.documentId,
    organizerId: "maya",
    priorAdvance: priorAdvanceOf(prior),
    documentText,
  });
}

const money = (r: Rules) => ({
  shares: r.shares,
  feePolicy: r.feePolicy,
  feeBearerId: r.feeBearerId,
  advance: r.advance && {
    id: r.advance.id,
    recipientId: r.advance.recipientId,
    amountCents: r.advance.amountCents,
    verified: r.advance.verified,
  },
});

test("answersFromRules round-trips through toRules: split before fees, with an invited person", () => {
  const agreement = wrap(team());
  const r = rules();
  const a = answersFromRules(agreement, r, "maya");
  assert.deepEqual(
    a.people.value.map((p) => [p.key, p.name, p.basisPoints, p.isSelf]),
    [
      ["maya", "Maya", 5000, true],
      ["jordan", "Jordan", 3000, false],
      ["pending:inv-r", "Riley", 2000, false],
    ],
  );
  const riley = a.people.value[2];
  assert.equal(riley.invitationId, "inv-r");
  assert.equal(riley.email, "riley@example.test");
  assert.equal(riley.userId, undefined);
  assert.equal(a.fees?.value, FeeChoice.BEFORE_SPLIT);
  assert.equal(
    a.people.source,
    AnswerSource.PERSON,
    "a human proposal has no clause chip",
  );
  assert.deepEqual(money(again(a, r)), money(r));
});

test("answersFromRules round-trips: organizer covers fees", () => {
  const r = rules({
    feePolicy: "ORGANIZER_SHARE" as never,
    feeBearerId: "maya",
  });
  const a = answersFromRules(wrap(team()), r, "maya");
  assert.equal(a.fees?.value, FeeChoice.ORGANIZER_SHARE);
  assert.equal(a.feeBearerId, "maya");
  assert.equal(a.feeBearerChoice, "KEEP");
  assert.deepEqual(money(again(a, r)), money(r));
});

test("answersFromRules round-trips: advance keeps its ID and its quoted clause", () => {
  const r = rules({
    source: source(DOC, RuleOrigin.SOURCE_CLAUSE),
    advance: {
      id: "adv-1",
      recipientId: "jordan",
      amountCents: 50000,
      verified: true,
      source: { ...source(QUOTE, RuleOrigin.SOURCE_CLAUSE), clause: "4.1" },
    },
  });
  const a = answersFromRules(wrap(team()), r, "maya");
  assert.deepEqual(a.advance?.value, {
    recipientKey: "jordan",
    amountCents: 50000,
    alreadyPaid: true,
  });
  assert.equal(a.advance?.source, AnswerSource.DOCUMENT);
  assert.equal(a.advance?.clause, "4.1");
  assert.equal(a.people.source, AnswerSource.DOCUMENT);
  assert.equal(a.people.clause, "4");
  const back = again(a, r, DOC);
  assert.deepEqual(money(back), money(r));
  assert.equal(back.advance!.source.origin, RuleOrigin.SOURCE_CLAUSE);
  assert.equal(back.advance!.source.excerpt, QUOTE);
  assert.equal(back.advance!.source.clause, "4.1");
});

test("answersFromRules round-trips the refunds choice and dates through the summary toRules writes", () => {
  const c = team();
  c.details = {
    currency: "USD" as never,
    effectiveFrom: "2026-10-01",
    effectiveTo: null,
  };
  const agreement = wrap(c);
  const first = answersFromRules(
    agreement,
    rules({
      advance: {
        id: "adv-1",
        recipientId: "maya",
        amountCents: 200000,
        verified: true,
        source: source(),
      },
    }),
    "maya",
  );
  assert.equal(first.refunds, undefined, "nothing said about refunds yet");
  assert.equal(first.effectiveFrom?.value, "2026-10-01");
  assert.equal(first.effectiveTo?.value, null);
  for (const choice of [RefundChoice.SPLIT, RefundChoice.ADVANCE]) {
    const written = toRules(
      { ...first, refunds: { value: choice, source: AnswerSource.PERSON } },
      { documentId: "doc1", organizerId: "maya" },
    );
    const read = answersFromRules(agreement, written, "maya");
    assert.equal(read.refunds?.value, choice);
    assert.deepEqual(money(again(read, written)), money(written));
  }
});

test("change request: parsed back into its part and note, resolved by sending a new version", () => {
  // Everyone has joined, so Riley can ask for a change.
  let c = createCollaboration(
    {
      id: "c",
      name: "Midnight Sessions",
      members: [
        { userId: "maya", displayName: "Maya", role: MemberRole.ORGANIZER },
        {
          userId: "jordan",
          displayName: "Jordan",
          role: MemberRole.COLLABORATOR,
        },
        {
          userId: "riley",
          displayName: "Riley Stone",
          role: MemberRole.COLLABORATOR,
        },
      ],
    },
    "maya",
    at,
  );
  const r = rules({
    shares: [
      { userId: "maya", basisPoints: 5000 },
      { userId: "jordan", basisPoints: 3000 },
      { userId: "riley", basisPoints: 2000 },
    ],
  });
  c = submitForApproval(c, r as DomainRules, "maya", at);
  c = approveAndSwitchOn(c, 1, "jordan", at);
  c = requestChange(
    c,
    1,
    changeRequestReason(WrongPart.SPLIT, "I agreed to 25%, not 20%."),
    "riley",
    at,
  );
  const asked = wrap(c, 4);
  assert.equal(
    agreementStatus(asked, "maya").stage,
    AgreementStage.ChangeRequested,
  );
  const [request] = openChangeRequests(asked);
  assert.deepEqual(
    { ...request },
    {
      userId: "riley",
      name: "Riley",
      at,
      part: WrongPart.SPLIT,
      note: "I agreed to 25%, not 20%.",
    },
  );
  assert.deepEqual(parseChangeRequest("Just a thought"), {
    part: WrongPart.OTHER,
    note: "Just a thought",
  });

  // Fix it: Riley 25%, Jordan 25%, then send through the same one-shot submit.
  const a = answersFromRules(asked, revisableRules(asked)!, "maya");
  a.people.value = a.people.value.map((p) => ({
    ...p,
    basisPoints: p.key === "maya" ? 5000 : 2500,
  }));
  c = submitForApproval(
    c,
    again(a, revisableRules(asked)!) as DomainRules,
    "maya",
    at,
  );
  const sent = wrap(c, 5);
  assert.deepEqual(openChangeRequests(sent), [], "the request is resolved");
  assert.deepEqual(Object.keys(c.versions[1].approvals), ["maya"]);
  const status = agreementStatus(sent, "maya");
  assert.equal(status.line, "Waiting for Jordan and Riley to approve");
  c = approveAndSwitchOn(c, 2, "jordan", at);
  c = approveAndSwitchOn(c, 2, "riley", at);
  assert.equal(c.activeVersionId, 2);
  assert.equal(c.versions[1].rules.shares[2].basisPoints, 2500);
});

test("advance change during a revise: new ID, the repaid amount carries over, never below it", () => {
  let c = createCollaboration(
    {
      id: "c",
      name: "Midnight Sessions",
      members: [
        { userId: "maya", displayName: "Maya", role: MemberRole.ORGANIZER },
        {
          userId: "jordan",
          displayName: "Jordan",
          role: MemberRole.COLLABORATOR,
        },
      ],
    },
    "maya",
    at,
  );
  const start = rules({
    shares: [
      { userId: "maya", basisPoints: 5000 },
      { userId: "jordan", basisPoints: 5000 },
    ],
    advance: {
      id: "adv-1",
      recipientId: "jordan",
      amountCents: 50000,
      verified: true,
      source: source(),
    },
  });
  c = submitForApproval(c, start as DomainRules, "maya", at);
  c = approveAndSwitchOn(c, 1, "jordan", at);
  c = allocateConfirmedRevenue(
    c,
    {
      providerCaptureId: "cap-1",
      currency: "USD",
      grossCents: 30000,
      feeCents: 0,
    },
    at,
  );
  assert.equal(c.recoupedByAdvance["adv-1"], 30000);

  const revise = (amountCents: number) => {
    const agreement = wrap(c);
    const prior = revisableRules(agreement)!;
    const a = answersFromRules(agreement, prior, "maya");
    a.advance = { ...a.advance!, value: { ...a.advance!.value, amountCents } };
    return again(a, prior) as DomainRules;
  };

  // Unchanged amount: same advance, nothing new to carry.
  assert.equal(revise(50000).advance!.id, "adv-1");
  // Lowered below what Jordan already got back: refused, nothing changes.
  assert.throws(
    () => submitForApproval(c, revise(20000), "maya", at),
    (e) => e instanceof DomainError && e.code === "ADVANCE_BELOW_RECOUPED",
  );
  // Raised: a new advance that continues from the $300 already repaid.
  const raised = revise(80000);
  assert.notEqual(raised.advance!.id, "adv-1");
  c = submitForApproval(c, raised, "maya", at);
  c = approveAndSwitchOn(c, 2, "jordan", at);
  assert.equal(c.activeVersionId, 2);
  assert.equal(c.recoupedByAdvance[raised.advance!.id], 30000);
});

test("revise questions: a fees request asks again from today's answer; open refunds are asked", () => {
  const a = answersFromRules(
    wrap(team()),
    rules({
      advance: {
        id: "adv-1",
        recipientId: "maya",
        amountCents: 200000,
        verified: true,
        source: source(),
      },
    }),
    "maya",
  );
  const questions = reviseQuestions(a, {
    userId: "jordan",
    name: "Jordan",
    part: WrongPart.FEES,
    note: "I thought Maya covered fees.",
    at,
  });
  assert.deepEqual(
    questions.map((q) => [q.id, q.answeredChoiceId]),
    [
      [StandardQuestionId.FEES, FeeChoice.BEFORE_SPLIT],
      [StandardQuestionId.REFUNDS, undefined],
    ],
  );
  assert.equal(questions[0].quote, "I thought Maya covered fees.");
  assert.equal(questions[0].clause, "Jordan's note");
  // Nothing requested and nothing open: straight to Send.
  assert.deepEqual(
    reviseQuestions({
      ...a,
      refunds: { value: RefundChoice.SPLIT, source: AnswerSource.PERSON },
    }),
    [],
  );
});

test("revise wizard opens on Check with the request pinned to the split card", () => {
  let c = team();
  c = submitForApproval(c, rules() as DomainRules, "maya", at);
  const html = renderToStaticMarkup(
    createElement(AgreementReviseWizard, {
      agreement: wrap(c),
      owner: { id: "maya", name: "Maya", email: "maya@example.test" },
      request: {
        userId: "jordan",
        name: "Jordan",
        part: WrongPart.SPLIT,
        note: "I agreed to 35%.",
        at,
      },
      onDone() {},
      onClose() {},
    }),
  );
  assert.match(html, /What should change\?/);
  assert.match(html, /Change agreement/);
  assert.match(html, /wc-card wc-flagged/);
  assert.match(html, /Jordan asked for a change to the split/);
  assert.match(html, /I agreed to 35%\./);
  assert.doesNotMatch(html, /Upload|Who should we send this to/);
});

test("revise keeps a former organizer as fee bearer unless the fee choice is changed", () => {
  // The organizer role moved from Maya to Jordan; Maya still covers the fees.
  const c = createCollaboration(
    {
      id: "c",
      name: "Midnight Sessions",
      members: [
        { userId: "jordan", displayName: "Jordan", role: MemberRole.ORGANIZER },
        { userId: "maya", displayName: "Maya", role: MemberRole.COLLABORATOR },
      ],
    },
    "jordan",
    at,
  );
  const prior = rules({
    shares: [
      { userId: "maya", basisPoints: 6000 },
      { userId: "jordan", basisPoints: 4000 },
    ],
    feePolicy: "ORGANIZER_SHARE" as never,
    feeBearerId: "maya",
  });
  const agreement = wrap(c);
  const a = answersFromRules(agreement, prior, "jordan");
  assert.equal(a.fees?.value, FeeChoice.ORGANIZER_SHARE);
  // A split change alone: Maya stays the fee bearer.
  a.people.value = a.people.value.map((p) => ({ ...p, basisPoints: 5000 }));
  const kept = revisedRules(a, prior, { organizerId: "jordan" });
  assert.equal(kept.feePolicy, "ORGANIZER_SHARE");
  assert.equal(kept.feeBearerId, "maya");
  assert.deepEqual(
    kept.shares.map((s) => s.basisPoints),
    [5000, 5000],
  );
  // Answering the visible question explicitly picks today's organizer, even if the
  // selected policy is the same as the old one.
  const b = feeQuestion(a)
    .choices.find((choice) => choice.id === FeeChoice.ORGANIZER_SHARE)!
    .apply(a);
  assert.equal(b.feeBearerId, undefined);
  assert.ok(summarySentences(b).includes("Jordan covers the PayPal fees."));
  assert.equal(feeLine(b), "PayPal fees come out of Jordan's share.");
  const switched = revisedRules(b, prior, { organizerId: "jordan" });
  assert.equal(switched.feeBearerId, "jordan");
});

test("revise submit recovery adopts only this attempt's exact sent rules", () => {
  const before = wrap(team(), 3);
  const submitted = rules();
  const committed = {
    ...before,
    revision: 4,
    value: {
      ...before.value,
      versions: [
        {
          id: 1,
          status: "AWAITING_APPROVAL",
          rules: submitted,
          approvals: {},
          changeRequests: [],
        },
      ],
    },
  } as Agreement;
  assert.equal(
    revisedSubmissionWasCommitted(before, committed, submitted),
    true,
  );
  const details = { name: "Revised title", effectiveFrom: "2026-12-01" };
  const matchingDetails = {
    ...committed,
    value: {
      ...committed.value,
      name: details.name,
      details: {
        currency: "USD" as const,
        effectiveFrom: details.effectiveFrom,
      },
    },
  } as Agreement;
  assert.equal(
    revisedSubmissionWasCommitted(before, matchingDetails, submitted, details),
    true,
  );
  assert.equal(
    revisedSubmissionWasCommitted(before, committed, submitted, details),
    false,
  );
  assert.equal(
    revisedSubmissionWasCommitted(
      before,
      {
        ...matchingDetails,
        value: {
          ...matchingDetails.value,
          details: {
            ...matchingDetails.value.details!,
            effectiveTo: "2026-12-31",
          },
        },
      },
      submitted,
      details,
    ),
    false,
  );
  assert.equal(
    revisedSubmissionWasCommitted(
      before,
      {
        ...committed,
        value: {
          ...committed.value,
          details: { currency: Currency.USD, effectiveFrom: "2026-11-30" },
        },
      },
      submitted,
    ),
    false,
  );
  assert.equal(
    revisedSubmissionWasCommitted(
      before,
      {
        ...committed,
        value: {
          ...committed.value,
          versions: [
            {
              id: 1,
              status: "AWAITING_APPROVAL",
              rules: rules({ source: source("Other") }),
              approvals: {},
              changeRequests: [],
            },
          ],
        },
      },
      submitted,
    ),
    false,
  );
});
