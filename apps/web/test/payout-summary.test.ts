import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizePayouts } from "../src/components/payoutSummary";
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
      attention: 500,
      paidCount: 1,
      processingCount: 2,
      attentionCount: 5,
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
