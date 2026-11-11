import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMember,
  allocateConfirmedRevenue,
  approveAndSwitchOn,
  createCollaboration,
  DomainError,
  FeePolicy,
  MemberRole,
  previewVersion,
  proposeVersion,
  RuleOrigin,
  submitForApproval,
  type Collaboration,
  type Rules,
} from "../src/index.ts";

const at = "2026-11-11T09:00:00.000Z";
const code = (expected: string) => (err: unknown) =>
  err instanceof DomainError && err.code === expected;
const source = {
  origin: RuleOrigin.HUMAN_PROPOSAL,
  documentId: "doc1",
  clause: "Advance",
  excerpt: "Jordan paid an advance that is repaid first.",
};
const rules = (
  id: string,
  amountCents: number,
  recipientId = "jordan",
): Rules => ({
  currency: "USD",
  shares: [
    { userId: "maya", basisPoints: 5000 },
    { userId: "jordan", basisPoints: 5000 },
  ],
  feePolicy: FeePolicy.BEFORE_SPLIT,
  advance: { id, recipientId, amountCents, verified: true, source },
  source,
  unresolvedQuestions: [],
});
/** Submit and have everyone approve, so the rules switch on. */
function adopt(c: Collaboration, r: Rules): Collaboration {
  c = submitForApproval(c, r, "maya", at);
  return approveAndSwitchOn(c, c.versions.at(-1)!.id, "jordan", at);
}
function start(amountCents = 50000): Collaboration {
  const c = addMember(
    createCollaboration(
      {
        id: "c",
        name: "Midnight",
        members: [
          { userId: "maya", displayName: "Maya", role: MemberRole.ORGANIZER },
        ],
      },
      "maya",
      at,
    ),
    { userId: "jordan", displayName: "Jordan" },
    "maya",
    at,
  );
  return adopt(c, rules("adv-1", amountCents));
}
let capture = 0;
const pay = (c: Collaboration, grossCents: number) =>
  allocateConfirmedRevenue(
    c,
    {
      providerCaptureId: `cap-${++capture}`,
      currency: "USD",
      grossCents,
      feeCents: 0,
    },
    at,
  );
const repaid = (c: Collaboration) =>
  c.revenue
    .flatMap((r) => r.allocations)
    .reduce((sum, a) => sum + a.recoupmentCents, 0);

test("correcting an advance before any payment works as before", () => {
  let c = adopt(start(), rules("adv-2", 40000));
  assert.equal(c.activeVersionId, 2);
  assert.equal(c.recoupedByAdvance["adv-2"], undefined);
  c = pay(c, 100000);
  assert.equal(c.revenue[0].allocations[1].recoupmentCents, 40000);
});

test("raising the advance after partial repayment continues from what was repaid", () => {
  let c = pay(start(), 30000);
  assert.equal(c.recoupedByAdvance["adv-1"], 30000);
  const preview = previewVersion(
    proposeVersion(c, rules("adv-2", 80000), "maya", at),
    2,
    { grossCents: 100000, feeCents: 0 },
    "maya",
  );
  assert.equal(preview.allocations[1].recoupmentCents, 50000);
  c = adopt(c, rules("adv-2", 80000));
  assert.equal(c.recoupedByAdvance["adv-2"], 30000);
  c = pay(c, 100000);
  assert.equal(c.revenue[1].allocations[1].recoupmentCents, 50000);
  c = pay(c, 100000);
  assert.equal(c.revenue[2].allocations[1].recoupmentCents, 0);
  assert.equal(repaid(c), 80000, "never more than the corrected amount");
  assert.equal(c.recoupedByAdvance["adv-2"], 80000);
});

test("an advance cannot be corrected below what was already repaid", () => {
  const c = pay(start(), 30000);
  assert.throws(
    () => proposeVersion(c, rules("adv-2", 29999), "maya", at),
    code("ADVANCE_BELOW_RECOUPED"),
  );
  // Exactly the repaid amount is fine: nothing more is recouped.
  let ok = adopt(c, rules("adv-2", 30000));
  ok = pay(ok, 10000);
  assert.equal(ok.revenue[1].allocations[1].recoupmentCents, 0);
  assert.equal(repaid(ok), 30000);
});

test("changing who the advance belongs to after repayment needs a human decision", () => {
  const c = pay(start(), 30000);
  assert.throws(
    () => proposeVersion(c, rules("adv-2", 50000, "maya"), "maya", at),
    code("ADVANCE_RECIPIENT_CHANGED"),
  );
  // Before any repayment the recipient can still be corrected.
  const fresh = adopt(start(), rules("adv-2", 50000, "maya"));
  assert.equal(fresh.versions[1].rules.advance!.recipientId, "maya");
});

test("payments that arrive while a correction awaits approval are re-checked at switch-on", () => {
  let c = pay(start(), 30000);
  c = submitForApproval(c, rules("adv-2", 40000), "maya", at);
  c = pay(c, 20000); // the old rules are still in force: repaid now 50000
  assert.equal(c.recoupedByAdvance["adv-1"], 50000);
  assert.throws(
    () => approveAndSwitchOn(c, 2, "jordan", at),
    code("ADVANCE_BELOW_RECOUPED"),
  );
});
