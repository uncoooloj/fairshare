import test from "node:test";
import assert from "node:assert/strict";
import {
  formatPaymentAmount,
  PaymentGridStatus,
  validatePaymentRows,
  type PaymentGridRow,
} from "../src/components/paymentGridModel";
const row: PaymentGridRow = {
  id: "p1",
  agreementId: "a1",
  agreementKey: '["w1","a1"]',
  agreementName: "Album",
  recipientName: "OJ",
  amountCents: 101,
  currency: "USD",
  status: PaymentGridStatus.Held,
  createdAt: "2026-11-10T12:00:00Z",
};
test("formats exact server cents without mutating ledger records", () => {
  assert.equal(formatPaymentAmount(101, "USD"), "$1.01");
  assert.equal(formatPaymentAmount(0, "USD"), "$0.00");
  const result = validatePaymentRows([row]);
  assert.deepEqual(result, [row]);
  assert.notEqual(result[0], row);
});
test("rejects duplicates, unsafe amounts, invalid dates and unknown status", () => {
  assert.throws(() => validatePaymentRows([row, row]));
  for (const override of [
    { amountCents: -1 },
    { amountCents: 1.2 },
    { amountCents: Number.MAX_SAFE_INTEGER + 1 },
    { createdAt: "wrong" },
    { status: "SUCCESS" },
    { currency: "GBP" },
  ]) {
    assert.throws(() =>
      validatePaymentRows([{ ...row, ...override } as PaymentGridRow]),
    );
  }
  assert.equal(formatPaymentAmount(NaN, "USD"), "Invalid amount");
});
test("empty history valid; held records remain held", () => {
  assert.deepEqual(validatePaymentRows([]), []);
  assert.equal(validatePaymentRows([row])[0].status, PaymentGridStatus.Held);
});
