import test from "node:test";
import assert from "node:assert/strict";
import {
  recoveryRequest,
  refundBlocked,
  refundMessage,
  createSingleFlight,
} from "../lib/payment-recovery";
const payment = { id: "p1", status: "ALLOCATED", provider_capture_id: "cap1" };
test("recovery only constructs evidence-link endpoints and exact provider keys", () => {
  assert.deepEqual(recoveryRequest("payment", "p1", " ORDER1 "), {
    path: "payments/p1/recover",
    body: { providerOrderId: "ORDER1" },
  });
  assert.deepEqual(recoveryRequest("payout", "p2", "BATCH1"), {
    path: "payouts/p2/recover",
    body: { providerBatchId: "BATCH1" },
  });
  assert.deepEqual(recoveryRequest("refund", "r1", "REF1"), {
    path: "refunds/r1/recover",
    body: { providerRefundId: "REF1" },
  });
  for (const input of [
    "",
    "https://paypal.com/x",
    "bad reference",
    "x".repeat(109),
  ])
    assert.throws(() => recoveryRequest("payment", "p", input));
});
test("refund offer blocks unverified capture, existing refund, any reserved payout and hold", () => {
  assert.equal(refundBlocked(payment, [], [], false), null);
  assert.match(
    refundBlocked({ ...payment, status: "OUTCOME_UNKNOWN" }, [], [], false)!,
    /payment has been split/,
  );
  assert.match(
    refundBlocked({ ...payment, provider_capture_id: null }, [], [], false)!,
    /payment has been split/,
  );
  assert.match(
    refundBlocked(
      payment,
      [],
      [{ payment_id: "p1", status: "OUTCOME_UNKNOWN" }],
      false,
    )!,
    /already recorded/,
  );
  for (const status of ["RESERVED", "FAILED", "SUCCESS", "OUTCOME_UNKNOWN"])
    assert.match(
      refundBlocked(payment, [{ capture_id: "cap1", status }], [], false)!,
      /payout has been reserved/,
    );
  assert.match(refundBlocked(payment, [], [], true)!, /hold/);
  assert.equal(
    refundBlocked(payment, [{ capture_id: "other" }], [], false),
    null,
  );
});
test("refund wording never confuses request acceptance with verified completion", () => {
  assert.match(refundMessage("COMPLETED"), /Refunded\..*paused/);
  assert.match(refundMessage("OUTCOME_UNKNOWN"), /Don’t refund again/);
  for (const status of ["SUBMITTING", "PENDING", "FAILED", "CANCELLED"])
    assert.match(
      refundMessage(status),
      /hasn’t completed|hasn’t confirmed completion/,
    );
});

test("rapid repeated actions are ignored while a provider request is pending", async () => {
  const run = createSingleFlight();
  let count = 0;
  let finish!: () => void;
  const pending = run(async () => {
    count++;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  await run(async () => {
    count++;
  });
  assert.equal(count, 1);
  finish();
  await pending;
  await run(async () => {
    count++;
  });
  assert.equal(count, 2);
});
test("a rejected action releases the submission lock without replaying it", async () => {
  const run = createSingleFlight();
  let count = 0;
  await assert.rejects(
    run(async () => {
      count++;
      throw new Error("unknown provider outcome");
    }),
  );
  assert.equal(count, 1);
  await run(async () => {
    count++;
  });
  assert.equal(count, 2);
});

test("failed recovery refresh hides stale refund actions and clears success notice", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../components/payment-recovery.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /await flight\.current/);
  assert.match(source, /setData\(\s*null\s*\);\s*setNotice\(\s*["']{2}\s*\);/);
  assert.match(source, /Refresh before you do anything else/);
  assert.match(
    source,
    /setConfirmed\(\s*false\s*\);\s*setError\(\s*["']{2}\s*\);\s*setNotice\(\s*["']{2}\s*\)/,
  );
});

test("invoice receipts use invoice reconciliation and never checkout refunds", async () => {
  const { paymentReconcilePath, refundablePayments } = await import(
    "../lib/payment-recovery"
  );
  const receipt = { ...payment, id: "receipt1", invoice_id: "inv1" };
  assert.equal(paymentReconcilePath(receipt), "invoices/inv1/reconcile");
  assert.equal(paymentReconcilePath(payment), "payments/p1/reconcile");
  assert.deepEqual(refundablePayments([receipt, payment]), [payment]);
  assert.match(
    refundBlocked(receipt, [], [], false)!,
    /Invoice refunds must be handled in PayPal/,
  );
});

test("refund permits only explicitly never-submitted reservations with no provider identity", () => {
  for (const status of ["WAITING_RECIPIENT", "AUTO_HELD", "RESERVED", "HELD"]) {
    const reservation = {
      capture_id: "cap1",
      status,
      batch_id: null,
      item_id: null,
    };
    assert.equal(refundBlocked(payment, [reservation], [], false), null);
    assert.match(
      refundBlocked(
        payment,
        [{ ...reservation, batch_id: "BATCH" }],
        [],
        false,
      )!,
      /payout has already started/,
    );
    assert.match(
      refundBlocked(payment, [{ ...reservation, item_id: "ITEM" }], [], false)!,
      /payout has already started/,
    );
  }
  assert.match(
    refundBlocked(
      payment,
      [
        {
          capture_id: "cap1",
          status: "SUBMITTING",
          batch_id: null,
          item_id: null,
        },
      ],
      [],
      false,
    )!,
    /payout has already started/,
  );
});
test("verified event recovery remains agreement scoped and never clears holds", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../components/payment-recovery.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /data\.events\.map/);
  assert.match(
    source,
    /recovery\/events\/\$\{encodeURIComponent\(event\.id\)\}\/reconcile/,
  );
  assert.match(source, /Operator\s+review is required/);
  assert.match(source, /Existing payment holds remain in place/);
});
