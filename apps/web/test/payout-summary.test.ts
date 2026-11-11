import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PayoutCardKind,
  payoutCards,
  payoutCount,
  summarizePayouts,
} from "../src/components/payoutSummary";
import {
  PaymentGridStatus as S,
  type PaymentGridRow,
} from "../src/components/paymentGridModel";
const row = (status: S, amountCents = 100): PaymentGridRow => ({
  id: status,
  payoutId: `payout-${status}`,
  agreementId: "a",
  agreementKey: '["w","a"]',
  agreementName: "Agreement",
  recipientName: "Person",
  amountCents,
  currency: "USD",
  status,
});
test("pending, unclaimed and uncertain funds are never counted as paid", () => {
  assert.deepEqual(
    summarizePayouts(Object.values(S).map((status) => row(status))),
    {
      paid: 100,
      processing: 200,
      attention: 600,
      paidCount: 1,
      processingCount: 2,
      attentionCount: 6,
    },
  );
});
test("empty totals and reversed transfers do not fabricate success", () => {
  assert.equal(summarizePayouts([]).paid, 0);
  assert.equal(summarizePayouts([row(S.Reversed)]).paid, 0);
});
test("invalid records and unsafe aggregate fail closed", () => {
  assert.throws(() => summarizePayouts([row(S.Paid, -1)]));
  assert.throws(() =>
    summarizePayouts([
      row(S.Paid, Number.MAX_SAFE_INTEGER),
      { ...row(S.Paid), id: "second" },
    ]),
  );
});
test("cards show a short, pluralised count and keep the detail for the tooltip", () => {
  const cards = payoutCards(
    summarizePayouts([row(S.Paid), row(S.Failed), { ...row(S.Held), id: "h" }]),
  );
  assert.deepEqual(
    cards.map((c) => [c.kind, c.caption]),
    [
      [PayoutCardKind.Paid, "1 payout paid"],
      [PayoutCardKind.OnTheWay, "0 payouts on the way"],
      [PayoutCardKind.Attention, "2 need attention"],
    ],
  );
  assert.equal(
    payoutCards(summarizePayouts([row(S.Failed)]))[2].caption,
    "1 needs attention",
  );
  for (const c of cards) {
    assert.ok(c.caption.length <= 24, c.caption);
    assert.ok(c.explanation.length > c.caption.length);
    assert.doesNotMatch(c.explanation, /PayPal/);
  }
  assert.equal(payoutCount(1), "1 payout");
  assert.equal(payoutCount(0), "0 payouts");
});
