import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activateVersion,
  allocateConfirmedRevenue,
  approveAndSwitchOn,
  AuditType,
  confirmAdvancePaid,
  createCollaboration,
  DomainError,
  FeePolicy,
  MemberRole,
  requestChange,
  RuleOrigin,
  submitForApproval,
  VersionStatus,
  type Collaboration,
  type Rules,
} from "../src/index.ts";

const at = "2026-11-11T09:00:00.000Z";
const code = (expected: string) => (err: unknown) =>
  err instanceof DomainError && err.code === expected;
const source = {
  origin: RuleOrigin.HUMAN_PROPOSAL,
  documentId: "doc1",
  clause: "Midnight",
  excerpt: "Maya put in $2,000 upfront and is paid back first.",
};
const rules = (verified: boolean): Rules => ({
  currency: "USD",
  shares: [
    { userId: "maya", basisPoints: 5000 },
    { userId: "jordan", basisPoints: 5000 },
  ],
  feePolicy: FeePolicy.BEFORE_SPLIT,
  advance: {
    id: "adv-1",
    recipientId: "maya",
    amountCents: 200000,
    verified,
    source,
  },
  source,
  unresolvedQuestions: [],
});
function pair(): Collaboration {
  return createCollaboration(
    {
      id: "c1",
      name: "Midnight",
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
}

test("rules with an advance not paid yet can be sent", () => {
  const c = submitForApproval(pair(), rules(false), "maya", at);
  assert.equal(c.versions[0].status, VersionStatus.AWAITING_APPROVAL);
  assert.equal(c.versions[0].rules.advance!.verified, false);
});

test("the last approval does not switch on while the advance is unconfirmed", () => {
  let c = submitForApproval(pair(), rules(false), "maya", at);
  c = approveAndSwitchOn(c, 1, "jordan", at);
  assert.equal(c.versions[0].status, VersionStatus.AWAITING_APPROVAL);
  assert.equal(c.activeVersionId, undefined);
  assert.throws(
    () => activateVersion(c, 1, "maya", at),
    code("ADVANCE_UNCONFIRMED"),
  );
});

test("confirming after everyone approved switches the agreement on, approvals intact", () => {
  let c = submitForApproval(pair(), rules(false), "maya", at);
  c = approveAndSwitchOn(c, 1, "jordan", at);
  c = confirmAdvancePaid(c, "adv-1", "maya", at);
  assert.equal(c.versions.length, 1, "no new version");
  assert.equal(c.versions[0].rules.advance!.verified, true);
  assert.deepEqual(Object.keys(c.versions[0].approvals).sort(), [
    "jordan",
    "maya",
  ]);
  assert.equal(c.activeVersionId, 1);
  assert.equal(c.versions[0].status, VersionStatus.ACTIVE);
  const types = c.audit.map((e) => e.type);
  assert.deepEqual(types.slice(-2), [
    AuditType.ADVANCE_CONFIRMED,
    AuditType.ACTIVATED,
  ]);
});

test("confirming before approvals only records it; the last approval then switches on", () => {
  let c = submitForApproval(pair(), rules(false), "maya", at);
  c = confirmAdvancePaid(c, "adv-1", "maya", at);
  assert.equal(c.activeVersionId, undefined);
  assert.equal(c.versions[0].status, VersionStatus.AWAITING_APPROVAL);
  assert.equal(c.versions[0].rules.advance!.verified, true);
  c = approveAndSwitchOn(c, 1, "jordan", at);
  assert.equal(c.activeVersionId, 1);
  // Once switched on there is nothing left to confirm.
  assert.throws(
    () => confirmAdvancePaid(c, "adv-1", "maya", at),
    code("INVALID_STATE"),
  );
});

test("only the organizer confirms, and only the current advance", () => {
  const c = submitForApproval(pair(), rules(false), "maya", at);
  assert.throws(
    () => confirmAdvancePaid(c, "adv-1", "jordan", at),
    code("FORBIDDEN"),
  );
  assert.throws(
    () => confirmAdvancePaid(c, "adv-other", "maya", at),
    code("STALE_VERSION"),
  );
  assert.throws(
    () => confirmAdvancePaid(pair(), "adv-1", "maya", at),
    code("INVALID_STATE"),
  );
  // A change request leaves a draft; confirming it is still allowed.
  const draft = requestChange(c, 1, "Wait", "jordan", at);
  assert.equal(
    confirmAdvancePaid(draft, "adv-1", "maya", at).versions[0].rules.advance!
      .verified,
    true,
  );
});

test("payback maths is the same whether the advance was confirmed at send or later", () => {
  const confirmedAtSend = approveAndSwitchOn(
    submitForApproval(pair(), rules(true), "maya", at),
    1,
    "jordan",
    at,
  );
  const confirmedLater = confirmAdvancePaid(
    approveAndSwitchOn(
      submitForApproval(pair(), rules(false), "maya", at),
      1,
      "jordan",
      at,
    ),
    "adv-1",
    "maya",
    at,
  );
  const pay = (c: Collaboration) =>
    allocateConfirmedRevenue(
      c,
      {
        providerCaptureId: "cap-1",
        currency: "USD",
        grossCents: 300000,
        feeCents: 10500,
      },
      at,
    ).revenue[0].allocations;
  assert.deepEqual(pay(confirmedLater), pay(confirmedAtSend));
  assert.equal(
    pay(confirmedLater).find((a) => a.userId === "maya")!.recoupmentCents,
    200000,
  );
});
