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
  releaseUndeliveredOverpayment,
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

function newVersion(c: Collaboration, r: Rules): Collaboration {
  const n = c.versions.length + 1;
  c = sendForReview(proposeVersion(c, r, "a", at), n, "a", at);
  for (const id of ["a", "b", "c"]) c = approveVersion(c, n, id, at);
  return activateVersion(c, n, "a", at);
}

test("a refund lowers the advance its payment repaid and the advance that count was carried onto", () => {
  let c = pay(active(rules({ advance: advance("adv-1", 2000) })), "CAP1");
  c = newVersion(c, rules({ advance: advance("adv-2", 3000) }));
  assert.equal(c.recoupedByAdvance["adv-2"], 2000);
  const r = refund(c, "R1", 500);
  assert.equal(r.held, false);
  assert.equal(r.collaboration.recoupedByAdvance["adv-1"], 1500);
  assert.equal(r.collaboration.recoupedByAdvance["adv-2"], 1500);
});

test("a refund never lowers a later, unrelated advance", () => {
  let c = pay(active(rules({ advance: advance("A", 2000) })), "P1");
  c = newVersion(c, rules()); // advance removed
  c = newVersion(
    c,
    rules({ advance: { ...advance("B", 3000), recipientId: "b" } }),
  );
  c = pay(c, "P2");
  assert.deepEqual({ ...c.recoupedByAdvance }, { A: 2000, B: 3000 });
  const r = refund(c, "R1", 10000, 300, notPaid, "P1");
  assert.deepEqual({ ...r.collaboration.recoupedByAdvance }, { A: 0, B: 3000 });
  assert.equal(r.held, false);
});

test("an older payment without a recorded advance lowers only its own and pauses when rules changed", () => {
  let c = pay(active(rules({ advance: advance("adv-1", 2000) })), "CAP1");
  delete c.revenue[0].advanceId; // recorded before payments kept their advance
  c = newVersion(c, rules({ advance: advance("adv-2", 3000) }));
  const r = refund(c, "R1", 500);
  assert.equal(r.held, true);
  assert.equal(r.collaboration.recoupedByAdvance["adv-1"], 1500);
  assert.equal(r.collaboration.recoupedByAdvance["adv-2"], 2000);
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

test("organizer fee return can repay a prior shortfall up to the original fee", () => {
  const organizerPays = rules({
    feePolicy: FeePolicy.ORGANIZER_SHARE,
    feeBearerId: "a",
    shares: [
      { userId: "a", basisPoints: 1000 },
      { userId: "b", basisPoints: 4500 },
      { userId: "c", basisPoints: 4500 },
    ],
  });
  const c = pay(active(organizerPays), "CAP1", 10000, 900);
  const partial = refund(c, "R1", 5000, 0).collaboration;
  assert.deepEqual({ ...partial.owedBack }, { a: 400 });
  const unchanged = structuredClone(partial);
  assert.throws(
    () => refund(partial, "bad", 5000, 901),
    code("REFUND_FEE_MISMATCH"),
  );
  assert.deepEqual(partial, unchanged);
  const complete = refund(partial, "R2", 5000, 900);
  assert.deepEqual(totals(complete.collaboration), { a: 0, b: 0, c: 0 });
  assert.equal(complete.collaboration.owedBack, undefined);
  assert.equal(complete.refund.shares[0].shortfallReturnedCents, 400);
  assert.equal(allocatedNetCents(complete.collaboration.revenue[0]), 0);
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
  assert.deepEqual(resumed.externallySettledOverpayments, {
    CAP1: { a: 2500 },
  });
  // New payments allocate normally afterwards.
  assert.deepEqual(totals(pay(resumed, "CAP2"), "CAP2"), {
    a: 4850,
    b: 2910,
    c: 1940,
  });
});

test("a returned payout restores credit after its overpayment was settled outside Fairshare", () => {
  const held = refund(pay(active(), "CAP1"), "R1", 10000, 300, {
    payoutsStarted: true,
    paidCents: { b: 2910 },
  }).collaboration;
  const resumed = resumePayouts(
    held,
    { offsetFromFuturePayouts: false, note: "Jordan settled by bank" },
    "a",
    at,
  );
  assert.deepEqual(resumed.externallySettledOverpayments, {
    CAP1: { b: 2910 },
  });
  const returned = releaseUndeliveredOverpayment(resumed, "CAP1", "b", at);
  assert.deepEqual(returned.creditBack, { b: 2910 });
  assert.equal(returned.externallySettledOverpayments, undefined);
  assert.deepEqual(
    releaseUndeliveredOverpayment(returned, "CAP1", "b", at),
    returned,
  );
});

test("external settlement keeps the full overpayment across sequential refunds", () => {
  const paid = { payoutsStarted: true, paidCents: { a: 4850 } };
  const once = refund(pay(active(), "CAP1"), "R1", 5000, 0, paid).collaboration;
  const held = refund(once, "R2", 5000, 0, paid).collaboration;
  const resumed = resumePayouts(
    held,
    { offsetFromFuturePayouts: false },
    "a",
    at,
  );
  assert.deepEqual(resumed.externallySettledOverpayments, {
    CAP1: { a: 4850 },
  });
  assert.deepEqual(
    releaseUndeliveredOverpayment(resumed, "CAP1", "a", at).creditBack,
    { a: 4850 },
  );
});

test("external settlement attributes only the newly owed capture after an earlier offset", () => {
  const c = pay(active(), "CAP1");
  const cap1Held = refund(c, "R1", 10000, 300, {
    payoutsStarted: true,
    paidCents: { b: 2910 },
  }).collaboration;
  const afterOffset = pay(
    resumePayouts(cap1Held, { offsetFromFuturePayouts: true }, "a", at),
    "CAP2",
  );
  const cap3 = pay(afterOffset, "CAP3");
  const cap3Held = refund(
    cap3,
    "R3",
    10000,
    300,
    {
      payoutsStarted: true,
      paidCents: { b: 2910 },
    },
    "CAP3",
  ).collaboration;
  const externallySettled = resumePayouts(
    cap3Held,
    { offsetFromFuturePayouts: false },
    "a",
    at,
  );
  assert.deepEqual(externallySettled.externallySettledOverpayments, {
    CAP3: { b: 2910 },
  });
  assert.deepEqual(
    releaseUndeliveredOverpayment(externallySettled, "CAP1", "b", at)
      .creditBack,
    { b: 2910 },
  );
});

test("a returned organizer fee consumes its prior offset recovery before another payout return", () => {
  const organizerPays = rules({
    feePolicy: FeePolicy.ORGANIZER_SHARE,
    feeBearerId: "a",
    shares: [
      { userId: "a", basisPoints: 1000 },
      { userId: "b", basisPoints: 4500 },
      { userId: "c", basisPoints: 4500 },
    ],
  });
  const partial = refund(
    pay(active(organizerPays), "CAP1", 10000, 900),
    "R1",
    5000,
    0,
  ).collaboration;
  const afterOffset = pay(
    resumePayouts(partial, { offsetFromFuturePayouts: true }, "a", at),
    "CAP2",
    4000,
    0,
  );
  assert.deepEqual(afterOffset.offsetRecovered, { a: 400 });
  const feeReturned = refund(afterOffset, "R2", 5000, 900).collaboration;
  assert.equal(feeReturned.offsetRecovered, undefined);
  const cap3 = pay(feeReturned, "CAP3", 10000, 900);
  const cap3Held = refund(
    cap3,
    "R3",
    10000,
    900,
    { payoutsStarted: true, paidCents: { a: 100 } },
    "CAP3",
  ).collaboration;
  const externallySettled = resumePayouts(
    cap3Held,
    { offsetFromFuturePayouts: false },
    "a",
    at,
  );
  assert.deepEqual(
    releaseUndeliveredOverpayment(externallySettled, "CAP3", "a", at)
      .creditBack,
    { a: 500 },
  );
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
  const recovery = next.revenue[1].allocations.find(
    (allocation) => allocation.userId === "b",
  )!.offsetAttributions;
  assert.deepEqual(recovery, [
    {
      liabilityId: '["CAP1","R1","b","PAYOUT_OVERPAYMENT"]',
      cents: 1200,
    },
  ]);
  const r = refund(next, "R2", 4000, 0, notPaid, "CAP2");
  assert.equal(r.held, true);
  assert.equal(r.refund.shares[1].offsetRestoredCents, 1200);
  assert.deepEqual({ ...r.collaboration.owedBack }, { b: 2910 });
  assert.deepEqual(totals(r.collaboration, "CAP2"), { a: 0, b: 0, c: 0 });
  const restored = r.collaboration.revenue[1].allocations.find(
    (allocation) => allocation.userId === "b",
  )!;
  assert.equal(restored.offsetAttributions, undefined);
  assert.deepEqual(restored.restoredOffsetAttributions, recovery);
  const replay = refund(r.collaboration, "R2", 4000, 0, notPaid, "CAP2");
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.collaboration, r.collaboration);
});

test("ambiguous legacy refund history blocks new money until operator attribution", () => {
  const held = refund(pay(active(), "CAP1"), "R1", 10000, 300, {
    payoutsStarted: true,
    paidCents: { b: 2910 },
  }).collaboration;
  const settled = resumePayouts(
    held,
    { offsetFromFuturePayouts: false },
    "a",
    at,
  );
  const legacy = structuredClone(settled);
  delete legacy.refundAttributionVersion;
  delete legacy.refundLiabilities;
  delete legacy.owedBack;
  delete legacy.offsetRecovered;
  delete legacy.creditBack;
  delete legacy.externallySettledOverpayments;
  for (const revenue of legacy.revenue)
    for (const allocation of revenue.allocations) {
      delete allocation.offsetAttributions;
      delete allocation.restoredOffsetAttributions;
      delete allocation.creditAttributions;
      delete allocation.returnedCreditAttributions;
    }
  // Historical reads stay available; only another money transition is refused.
  assert.deepEqual(totals(legacy), { a: 0, b: 0, c: 0 });
  const before = structuredClone(legacy);
  assert.throws(() => pay(legacy, "CAP2"), code("ATTRIBUTION_REQUIRED"));
  assert.deepEqual(legacy, before);
});

test("a payout PayPal never delivered releases the overpayment it caused, once; shortfalls stay owed", () => {
  const c = pay(active(), "CAP1");
  const held = refund(c, "R1", 10000, 0, {
    payoutsStarted: true,
    paidCents: { a: 4850, b: 2910 },
  }).collaboration;
  // a: 4850 paid + 150 fee shortfall; b: 2910 + 90; c: 60.
  assert.deepEqual({ ...held.owedBack }, { a: 5000, b: 3000, c: 60 });
  let next = resumePayouts(held, { offsetFromFuturePayouts: true }, "a", at);
  next = releaseUndeliveredOverpayment(next, "CAP1", "b", at);
  assert.deepEqual({ ...next.owedBack }, { a: 5000, b: 90, c: 60 });
  assert.equal(next.offsetOwedBack, true);
  assert.deepEqual(releaseUndeliveredOverpayment(next, "CAP1", "b", at), next);
  // Nothing was overpaid to c, so nothing is released.
  assert.deepEqual(
    { ...releaseUndeliveredOverpayment(next, "CAP1", "c", at).owedBack },
    { a: 5000, b: 90, c: 60 },
  );
});

test("offset first, payout returned later: what was kept back is given back on the next share", () => {
  // b's 2910 from P1 counted as paid; P1 fully refunded, so b owes 2910.
  const c = pay(active(), "CAP1");
  const held = refund(c, "R1", 10000, 300, {
    payoutsStarted: true,
    paidCents: { b: 2910 },
  }).collaboration;
  assert.deepEqual({ ...held.owedBack }, { b: 2910 });
  // Resume with offset: P2 keeps back all 2910 of b's share.
  let next = pay(
    resumePayouts(held, { offsetFromFuturePayouts: true }, "a", at),
    "CAP2",
  );
  assert.deepEqual(totals(next, "CAP2"), { a: 4850, b: 0, c: 1940 });
  assert.equal(next.owedBack, undefined);
  // Then PayPal returns b's P1 payout: b never got it, so the 2910 comes back to b.
  next = releaseUndeliveredOverpayment(next, "CAP1", "b", at);
  assert.equal(next.owedBack, undefined);
  assert.deepEqual({ ...next.creditBack }, { b: 2910 });
  // P2 stays as recorded; the next payment adds it to b's share, once.
  assert.deepEqual(totals(next, "CAP2"), { a: 4850, b: 0, c: 1940 });
  next = pay(next, "CAP3");
  const b3 = next.revenue[2].allocations.find((x) => x.userId === "b")!;
  assert.equal(b3.creditCents, 2910);
  assert.equal(b3.totalCents, 2910 + 2910);
  assert.equal(next.creditBack, undefined);
  assert.equal(
    explainRecordedAllocation(next, "a", "CAP3", "b").allocatedCents,
    5820,
  );
  assert.deepEqual(totals(pay(next, "CAP4"), "CAP4"), {
    a: 4850,
    b: 2910,
    c: 1940,
  });
  // Seeing the return again gives nothing more.
  assert.equal(
    releaseUndeliveredOverpayment(next, "CAP1", "b", at).creditBack,
    undefined,
  );
});
