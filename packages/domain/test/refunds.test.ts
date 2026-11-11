import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCollaboration,
  proposeVersion,
  sendForReview,
  approveVersion,
  activateVersion,
  allocateConfirmedRevenue,
  applyCaptureRefund,
  allocatedNetCents,
  resumePayouts,
  previewVersion,
  MemberRole,
  RuleOrigin,
  FeePolicy,
  RefundKind,
  RevenueStatus,
  AllocationStatus,
  DomainError,
  type Rules,
  type Collaboration,
  type CapturePayoutState,
} from "../src/index.ts";
import { explainRecordedAllocation } from "../src/analytics.ts";

const at = "2026-11-11T12:00:00.000Z";
const source = {
  origin: RuleOrigin.HUMAN_PROPOSAL,
  documentId: "doc1",
  clause: "Split",
  excerpt: "Split the money 50/30/20.",
};
const rules = (over: Partial<Rules> = {}): Rules => ({
  currency: "USD",
  shares: [
    { userId: "a", basisPoints: 5000 },
    { userId: "b", basisPoints: 3000 },
    { userId: "c", basisPoints: 2000 },
  ],
  feePolicy: FeePolicy.BEFORE_SPLIT,
  source,
  unresolvedQuestions: [],
  ...over,
});
const advance = (id = "adv-1", amountCents = 2000) => ({
  id,
  recipientId: "a",
  amountCents,
  verified: true,
  source,
});
function active(r = rules()): Collaboration {
  let c = createCollaboration(
    {
      id: "collab",
      name: "Midnight",
      members: [
        { userId: "a", displayName: "Maya", role: MemberRole.ORGANIZER },
        { userId: "b", displayName: "Jordan", role: MemberRole.COLLABORATOR },
        { userId: "c", displayName: "Riley", role: MemberRole.COLLABORATOR },
      ],
    },
    "a",
    at,
  );
  c = sendForReview(proposeVersion(c, r, "a", at), 1, "a", at);
  for (const id of ["a", "b", "c"]) c = approveVersion(c, 1, id, at);
  return activateVersion(c, 1, "a", at);
}
const pay = (
  c: Collaboration,
  id: string,
  grossCents = 10000,
  feeCents = 300,
) =>
  allocateConfirmedRevenue(
    c,
    { providerCaptureId: id, currency: "USD", grossCents, feeCents },
    at,
  );
const notPaid: CapturePayoutState = { payoutsStarted: false, paidCents: {} };
const refund = (
  c: Collaboration,
  refundId: string,
  grossCents: number,
  feeReturnedCents = 0,
  payouts = notPaid,
  captureId = "CAP1",
  kind = RefundKind.REFUND,
) =>
  applyCaptureRefund(
    c,
    { refundId, captureId, kind, grossCents, feeReturnedCents },
    payouts,
    at,
  );
const totals = (c: Collaboration, captureId = "CAP1") =>
  Object.fromEntries(
    c.revenue
      .find((r) => r.providerCaptureId === captureId)!
      .allocations.map((a) => [a.userId, a.totalCents]),
  );
const code = (expected: string) => (err: unknown) =>
  err instanceof DomainError && err.code === expected;

test("full refund before payout with the fee returned reverses every share to zero without pausing", () => {
  const c = pay(active(), "CAP1");
  assert.deepEqual(totals(c), { a: 4850, b: 2910, c: 1940 });
  const r = refund(c, "R1", 10000, 300);
  assert.equal(r.held, false);
  assert.equal(r.collaboration.reviewHold, false);
  assert.deepEqual(totals(r.collaboration), { a: 0, b: 0, c: 0 });
  assert.equal(r.collaboration.owedBack, undefined);
  assert.equal(
    r.collaboration.revenue[0].allocations[0].status,
    AllocationStatus.ALLOCATED,
  );
  // The original payment is kept as recorded; the refund sits beside it.
  assert.equal(r.collaboration.revenue[0].grossCents, 10000);
  assert.equal(r.collaboration.revenue[0].refunds!.length, 1);
});

test("partial refund before payout comes off the split in proportion; an unreturned fee is shared by the split", () => {
  const c = pay(active(), "CAP1");
  const r = refund(c, "R1", 5000);
  assert.equal(r.held, false);
  assert.deepEqual(totals(r.collaboration), { a: 2350, b: 1410, c: 940 });
  assert.deepEqual(
    r.refund.shares.map((s) => [s.userId, s.shareCents]),
    [
      ["a", 2500],
      ["b", 1500],
      ["c", 1000],
    ],
  );
  // With the fee portion returned, only the net refund comes off.
  const returned = refund(c, "R1", 5000, 150);
  assert.deepEqual(totals(returned.collaboration), {
    a: 2425,
    b: 1455,
    c: 970,
  });
});

test("multiple partial refunds use largest remainder, never go negative and cannot exceed the payment", () => {
  const thirds = rules({
    shares: [
      { userId: "a", basisPoints: 3333 },
      { userId: "b", basisPoints: 3333 },
      { userId: "c", basisPoints: 3334 },
    ],
  });
  let c = pay(active(thirds), "CAP1", 1001, 0);
  assert.deepEqual(totals(c), { a: 334, b: 333, c: 334 });
  let r = refund(c, "R1", 500);
  // 500 over 334/333/334: floors 166 each, the two largest remainders (a, c) get a cent.
  assert.deepEqual(totals(r.collaboration), { a: 167, b: 167, c: 167 });
  c = r.collaboration;
  assert.throws(() => refund(c, "R2", 502), code("REFUND_EXCEEDS_PAYMENT"));
  r = refund(c, "R2", 501);
  assert.deepEqual(totals(r.collaboration), { a: 0, b: 0, c: 0 });
  assert.throws(
    () => refund(r.collaboration, "R3", 1),
    code("REFUND_EXCEEDS_PAYMENT"),
  );

  // Many small refunds: every step is nonnegative and the money always reconciles.
  let many = pay(active(), "CAP1", 9999, 299);
  let left = 9999;
  for (let i = 0; left > 0; i++) {
    const amount = Math.min(left, 37 + ((i * 53) % 211));
    const before = totals(many);
    const step = refund(many, `S${i}`, amount, 0);
    many = step.collaboration;
    for (const [user, cents] of Object.entries(totals(many))) {
      assert.ok(cents >= 0);
      assert.ok(cents <= before[user]);
    }
    const revenue = many.revenue[0];
    assert.equal(
      revenue.allocations.reduce((s, a) => s + a.totalCents, 0),
      allocatedNetCents(revenue),
    );
    left -= amount;
  }
  assert.deepEqual(totals(many), { a: 0, b: 0, c: 0 });
});

test("a refund reduces what the payment paid back on the advance first, so the advance counts as less paid back", () => {
  let c = pay(active(rules({ advance: advance("adv-1", 2000) })), "CAP1");
  const a = () => c.revenue[0].allocations.find((x) => x.userId === "a")!;
  assert.equal(a().recoupmentCents, 2000);
  assert.equal(c.recoupedByAdvance["adv-1"], 2000);
  let r = refund(c, "R1", 1000);
  c = r.collaboration;
  assert.equal(r.held, false);
  assert.equal(a().recoupmentCents, 1000);
  assert.equal(c.recoupedByAdvance["adv-1"], 1000);
  // Split untouched while the advance repayment absorbs the refund.
  assert.deepEqual(
    c.revenue[0].allocations.map((x) => x.shareCents),
    [3850, 2310, 1540],
  );
  // The next payment pays the advance back again.
  c = pay(c, "CAP2");
  assert.equal(
    c.revenue[1].allocations.find((x) => x.userId === "a")!.recoupmentCents,
    1000,
  );
  assert.equal(c.recoupedByAdvance["adv-1"], 2000);
  // A larger refund on the first payment: the rest of its advance repayment, then the split.
  r = refund(c, "R2", 1500);
  assert.equal(
    r.collaboration.revenue[0].allocations.find((x) => x.userId === "a")!
      .recoupmentCents,
    0,
  );
  assert.equal(r.refund.shares[0].recoupmentCents, 1000);
  assert.equal(
    r.refund.shares.reduce((s, x) => s + x.shareCents, 0),
    500,
  );
  assert.equal(r.collaboration.recoupedByAdvance["adv-1"], 1000);
});

test("a refund on a payment made under a replaced advance pauses for review", () => {
  let c = pay(active(rules({ advance: advance("adv-1", 2000) })), "CAP1");
  c = proposeVersion(c, rules({ advance: advance("adv-2", 3000) }), "a", at);
  c = sendForReview(c, 2, "a", at);
  for (const id of ["a", "b", "c"]) c = approveVersion(c, 2, id, at);
  c = activateVersion(c, 2, "a", at);
  assert.equal(c.recoupedByAdvance["adv-2"], 2000);
  const r = refund(c, "R1", 500);
  assert.equal(r.held, true);
  assert.equal(r.collaboration.recoupedByAdvance["adv-1"], 1500);
  assert.equal(r.collaboration.recoupedByAdvance["adv-2"], 1500);
});

test("organizer-covers-fees: refunds come off gross shares and only a returned fee goes back to the organizer", () => {
  const organizerPays = rules({
    feePolicy: FeePolicy.ORGANIZER_SHARE,
    feeBearerId: "a",
  });
  const c = pay(active(organizerPays), "CAP1");
  assert.deepEqual(totals(c), { a: 4700, b: 3000, c: 2000 });
  const returned = refund(c, "R1", 5000, 150);
  assert.deepEqual(totals(returned.collaboration), {
    a: 2350,
    b: 1500,
    c: 1000,
  });
  const kept = refund(c, "R1", 5000, 0);
  assert.deepEqual(totals(kept.collaboration), { a: 2200, b: 1500, c: 1000 });
  assert.equal(kept.held, false);
  // Full refund, fee kept by PayPal: the organizer still covers it, now as a shortfall.
  const full = refund(c, "R1", 10000, 0);
  assert.deepEqual(totals(full.collaboration), { a: 0, b: 0, c: 0 });
  assert.equal(full.held, true);
  assert.deepEqual({ ...full.collaboration.owedBack }, { a: 300 });
});

test("full refund before payout with the fee kept: the fee is shared by the split as owed and the agreement pauses", () => {
  const c = pay(active(), "CAP1");
  const r = refund(c, "R1", 10000, 0);
  assert.deepEqual(totals(r.collaboration), { a: 0, b: 0, c: 0 });
  assert.equal(r.held, true);
  assert.equal(r.collaboration.reviewHold, true);
  assert.deepEqual({ ...r.collaboration.owedBack }, { a: 150, b: 90, c: 60 });
});

test("replaying the same refund changes nothing; the same ID with different money is refused", () => {
  const c = pay(active(), "CAP1");
  const once = refund(c, "R1", 5000).collaboration;
  const twice = refund(once, "R1", 5000);
  assert.equal(twice.duplicate, true);
  assert.deepEqual(twice.collaboration, once);
  assert.throws(() => refund(once, "R1", 4000), code("REFUND_CONFLICT"));
});

test("after payouts: the agreement pauses and records what each person was overpaid, incrementally", () => {
  const c = pay(active(), "CAP1");
  const paid = { payoutsStarted: true, paidCents: { a: 4850 } };
  let r = refund(c, "R1", 5000, 0, paid);
  assert.equal(r.held, true);
  assert.equal(r.collaboration.reviewHold, true);
  assert.equal(
    r.collaboration.revenue[0].status,
    RevenueStatus.REVIEW_REQUIRED,
  );
  assert.ok(
    r.collaboration.revenue[0].allocations.every(
      (a) => a.status === AllocationStatus.HELD,
    ),
  );
  assert.deepEqual(totals(r.collaboration), { a: 2350, b: 1410, c: 940 });
  assert.deepEqual({ ...r.collaboration.owedBack }, { a: 2500 });
  // The rest: a is now owed back everything paid plus a share of the kept fee.
  r = refund(r.collaboration, "R2", 5000, 0, paid);
  assert.deepEqual(totals(r.collaboration), { a: 0, b: 0, c: 0 });
  assert.deepEqual(
    { ...r.collaboration.owedBack },
    { a: 2350 + 2500 + 150, b: 90, c: 60 },
  );
});

test("a reversal pauses even before payouts", () => {
  const c = pay(active(), "CAP1");
  const r = refund(c, "rev", 10000, 0, notPaid, "CAP1", RefundKind.REVERSAL);
  assert.equal(r.held, true);
  assert.deepEqual(totals(r.collaboration), { a: 0, b: 0, c: 0 });
});

test("resume needs the organizer and a pause; without offset the owed amounts are cleared as settled", () => {
  const c = pay(active(), "CAP1");
  const held = refund(c, "R1", 5000, 0, {
    payoutsStarted: true,
    paidCents: { a: 4850 },
  }).collaboration;
  assert.throws(
    () => resumePayouts(held, { offsetFromFuturePayouts: false }, "b", at),
    code("FORBIDDEN"),
  );
  assert.throws(
    () => resumePayouts(c, { offsetFromFuturePayouts: false }, "a", at),
    code("NOT_PAUSED"),
  );
  const resumed = resumePayouts(
    held,
    { offsetFromFuturePayouts: false, note: "Maya paid it back by bank" },
    "a",
    at,
  );
  assert.equal(resumed.reviewHold, false);
  assert.equal(resumed.owedBack, undefined);
  assert.equal(resumed.revenue[0].status, RevenueStatus.CONFIRMED);
  assert.ok(
    resumed.revenue[0].allocations.every(
      (a) => a.status === AllocationStatus.ALLOCATED,
    ),
  );
  const entry = resumed.audit.at(-1)!;
  assert.equal(entry.type, "PAYOUTS_RESUMED");
  assert.deepEqual(entry.details.owedCents, { a: 2500 });
  assert.equal(entry.details.note, "Maya paid it back by bank");
  // New payments allocate normally afterwards.
  assert.deepEqual(totals(pay(resumed, "CAP2"), "CAP2"), {
    a: 4850,
    b: 2910,
    c: 1940,
  });
});

test("offset: each person's overpayment comes off their next shares until settled", () => {
  const c = pay(active(), "CAP1");
  const held = refund(c, "R1", 10000, 300, {
    payoutsStarted: true,
    paidCents: { a: 4850, b: 2910 },
  }).collaboration;
  assert.deepEqual({ ...held.owedBack }, { a: 4850, b: 2910 });
  let next = resumePayouts(held, { offsetFromFuturePayouts: true }, "a", at);
  assert.equal(next.offsetOwedBack, true);
  next = pay(next, "CAP2");
  const cap2 = next.revenue[1].allocations;
  assert.deepEqual(
    cap2.map((a) => [a.userId, a.offsetCents ?? 0, a.totalCents]),
    [
      ["a", 4850, 0],
      ["b", 2910, 0],
      ["c", 0, 1940],
    ],
  );
  assert.equal(next.owedBack, undefined);
  assert.equal(next.offsetOwedBack, undefined);
  // Ledger still explains the kept-back amount.
  assert.equal(
    explainRecordedAllocation(next, "a", "CAP2", "a").allocatedCents,
    0,
  );

  // Settling across two payments.
  const owing = resumePayouts(
    refund(pay(active(), "CAP1"), "R1", 10000, 300, {
      payoutsStarted: true,
      paidCents: { a: 4850 },
    }).collaboration,
    { offsetFromFuturePayouts: true },
    "a",
    at,
  );
  const first = pay(owing, "CAP2", 4000, 0);
  assert.deepEqual(totals(first, "CAP2"), { a: 0, b: 1200, c: 800 });
  assert.deepEqual({ ...first.owedBack }, { a: 2850 });
  const second = pay(first, "CAP3", 10000, 300);
  assert.deepEqual(totals(second, "CAP3"), { a: 2000, b: 2910, c: 1940 });
  assert.equal(second.owedBack, undefined);
  // Preview shows the rules alone, not kept-back amounts.
  assert.equal(
    previewVersion(first, 1, { grossCents: 10000, feeCents: 300 }, "a")
      .allocations[0].totalCents,
    4850,
  );
});

test("refunding a payment that settled an overpayment makes it owed again", () => {
  const c = pay(active(), "CAP1");
  const held = refund(c, "R1", 10000, 300, {
    payoutsStarted: true,
    paidCents: { b: 2910 },
  }).collaboration;
  let next = pay(
    resumePayouts(held, { offsetFromFuturePayouts: true }, "a", at),
    "CAP2",
    4000,
    0,
  );
  // b's 1200 share went to settling; 1710 still owed.
  assert.deepEqual({ ...next.owedBack }, { b: 1710 });
  const r = refund(next, "R2", 4000, 0, notPaid, "CAP2");
  assert.equal(r.held, true);
  assert.equal(r.refund.shares[1].offsetRestoredCents, 1200);
  assert.deepEqual({ ...r.collaboration.owedBack }, { b: 2910 });
  assert.deepEqual(totals(r.collaboration, "CAP2"), { a: 0, b: 0, c: 0 });
});
