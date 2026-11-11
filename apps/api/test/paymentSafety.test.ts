import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  pendingWebhookBlocksPayout,
  webhookBelongsOnlyTo,
  payoutWasNeverSubmitted,
} from "../src/paymentSafety.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE fairshare_captures(provider_capture_id TEXT,workspace_id TEXT,collaboration_id TEXT);
    INSERT INTO fairshare_captures VALUES('cap-a','workspace','a'),('cap-a2','workspace','a'),('cap-b','workspace','b'),('cap-c','other','c');
    CREATE TABLE fairshare_payment_ops(provider_order_id TEXT,workspace_id TEXT,collaboration_id TEXT);
    INSERT INTO fairshare_payment_ops VALUES('order-a','workspace','a'),('order-b','workspace','b');
    CREATE TABLE fairshare_invoices(provider_id TEXT,workspace_id TEXT,collaboration_id TEXT);
    INSERT INTO fairshare_invoices VALUES('invoice-a','workspace','a'),('invoice-b','workspace','b');
    CREATE TABLE fairshare_refund_ops(provider_refund_id TEXT,workspace_id TEXT,collaboration_id TEXT);
    INSERT INTO fairshare_refund_ops VALUES('refund-a','workspace','a');
    CREATE TABLE fairshare_payout_ops(batch_id TEXT,workspace_id TEXT,collaboration_id TEXT);
    INSERT INTO fairshare_payout_ops VALUES('batch-a','workspace','a');
    CREATE TABLE fairshare_webhook_inbox(action TEXT,status TEXT);`);
  const insert = (action: unknown, status = "PENDING") =>
    db
      .prepare("INSERT INTO fairshare_webhook_inbox VALUES(?,?)")
      .run(JSON.stringify(action), status);
  const target = (id = "a") => ({
    provider_capture_id: `cap-${id}`,
    workspace_id: "workspace",
    collaboration_id: id,
  });
  return { db, insert, target };
}

test("explicit unmatched captures do not hold unrelated money, but known references hold the whole affected agreement", () => {
  const f = fixture();
  try {
    f.insert({ kind: "HOLD_CAPTURE", providerId: "merchant-external-capture" });
    assert.equal(pendingWebhookBlocksPayout(f.db, f.target()), false);
    assert.equal(
      pendingWebhookBlocksPayout(f.db, {
        ...f.target(),
        provider_capture_id: "merchant-external-capture",
      }),
      true,
    );
    f.insert({ kind: "HOLD_CAPTURE", providerId: "cap-a2" });
    assert.equal(pendingWebhookBlocksPayout(f.db, f.target()), true);
    assert.equal(pendingWebhookBlocksPayout(f.db, f.target("b")), false);
  } finally {
    f.db.close();
  }
});

test("orders, invoices, and refunds hold only their verified local agreement", () => {
  for (const action of [
    { kind: "HOLD_CAPTURE", orderId: "order-a" },
    {
      kind: "RECONCILE_INVOICE",
      providerId: "invoice-a",
      eventType: "INVOICING.INVOICE.REFUNDED",
    },
    {
      kind: "RECONCILE_REFUND",
      providerId: "refund-a",
      eventType: "PAYMENT.REFUND.PENDING",
    },
  ]) {
    const f = fixture();
    try {
      f.insert(action);
      assert.equal(pendingWebhookBlocksPayout(f.db, f.target()), true);
      assert.equal(pendingWebhookBlocksPayout(f.db, f.target("b")), false);
      assert.equal(webhookBelongsOnlyTo(f.db, action, f.target()), true);
    } finally {
      f.db.close();
    }
  }
});

test("missing, ambiguous, malformed, unknown, and legacy refund provenance all fail closed", () => {
  for (const action of [
    null,
    [],
    {},
    { kind: "unexpected" },
    { kind: "HOLD_CAPTURE" },
    { kind: "HOLD_CAPTURE", providerIds: ["cap-a", null] },
    { kind: "HOLD_CAPTURE", providerIds: [] },
    {
      kind: "HOLD_CAPTURE",
      providerId: "refund-a",
      eventType: "PAYMENT.CAPTURE.REFUNDED",
    },
    {
      kind: "RECORD_UNMATCHED",
      reason: "UNSUPPORTED_WEBHOOK_EVENT",
      providerId: "cap-b",
    },
    { kind: "RECORD_UNMATCHED", eventType: "INVOICING.INVOICE.REFUNDED" },
    { kind: "RECORD_UNMATCHED", eventType: "PAYMENT.REFUND.PENDING" },
  ]) {
    const f = fixture();
    try {
      f.insert(action);
      assert.equal(
        pendingWebhookBlocksPayout(f.db, f.target("b")),
        true,
        JSON.stringify(action),
      );
    } finally {
      f.db.close();
    }
  }
  const f = fixture();
  try {
    f.db.exec("INSERT INTO fairshare_webhook_inbox VALUES('{','PENDING')");
    assert.equal(pendingWebhookBlocksPayout(f.db, f.target()), true);
  } finally {
    f.db.close();
  }
});

test("all dispute targets are held, but cross-agreement and partly unmatched events cannot be replayed by an organizer", () => {
  const f = fixture();
  try {
    const action = {
      kind: "HOLD_CAPTURE",
      providerIds: ["cap-a", "cap-c", "unmatched"],
    };
    f.insert(action);
    assert.equal(pendingWebhookBlocksPayout(f.db, f.target()), true);
    assert.equal(pendingWebhookBlocksPayout(f.db, f.target("b")), false);
    assert.equal(
      pendingWebhookBlocksPayout(f.db, {
        provider_capture_id: "cap-c",
        workspace_id: "other",
        collaboration_id: "c",
      }),
      true,
    );
    assert.equal(webhookBelongsOnlyTo(f.db, action, f.target()), false);
    assert.equal(
      webhookBelongsOnlyTo(
        f.db,
        { kind: "HOLD_CAPTURE", providerId: "unmatched" },
        f.target(),
      ),
      false,
    );
  } finally {
    f.db.close();
  }
});

test("completed events and positive settlement reads do not impose a new hold", () => {
  const f = fixture();
  try {
    f.insert({ kind: "HOLD_CAPTURE" }, "DONE");
    f.insert({ kind: "RECONCILE_CAPTURE", orderId: "order-b" });
    assert.equal(pendingWebhookBlocksPayout(f.db, f.target()), false);
  } finally {
    f.db.close();
  }
});

test("only explicit pre-provider statuses without either provider identifier are refundable", () => {
  for (const status of ["WAITING_RECIPIENT", "AUTO_HELD", "RESERVED", "HELD"]) {
    assert.equal(
      payoutWasNeverSubmitted({ status, batch_id: null, item_id: null }),
      true,
    );
    assert.equal(
      payoutWasNeverSubmitted({ status, batch_id: "batch", item_id: null }),
      false,
    );
    assert.equal(
      payoutWasNeverSubmitted({ status, batch_id: null, item_id: "item" }),
      false,
    );
    assert.equal(
      payoutWasNeverSubmitted({ status, batch_id: undefined, item_id: null }),
      false,
    );
  }
  for (const status of [
    "SUBMITTING",
    "OUTCOME_UNKNOWN",
    "PENDING",
    "SUCCESS",
    "FAILED",
    "RETURNED",
    "CANCELLED_FOR_REFUND",
    "NEW_STATUS",
  ])
    assert.equal(
      payoutWasNeverSubmitted({ status, batch_id: null, item_id: null }),
      false,
    );
});
