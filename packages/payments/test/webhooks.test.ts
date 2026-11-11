import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyAndPlanWebhook,
  canRepairRefundPlan,
  enqueueVerifiedWebhook,
  reconcileCapture,
  WebhookActionKind,
} from "../src/webhooks.js";
const client = { verifyWebhook: async () => true };
const event = {
  id: "evt1",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: {
    id: "cap1",
    supplementary_data: { related_ids: { order_id: "order1" } },
  },
};
test("signed completion only schedules provider reconciliation, never credits directly", async () => {
  const e = await verifyAndPlanWebhook(client, {}, event);
  assert.equal(e.action.kind, WebhookActionKind.ReconcileCapture);
  assert.equal(e.action.orderId, "order1");
});
test("invalid signature cannot enqueue", async () => {
  await assert.rejects(
    verifyAndPlanWebhook({ verifyWebhook: async () => false }, {}, event),
    { code: "INVALID_WEBHOOK_SIGNATURE" },
  );
});
test("duplicate events are processed once even with reordered JSON keys", async () => {
  const a = await verifyAndPlanWebhook(client, {}, event);
  const b = await verifyAndPlanWebhook(
    client,
    {},
    { resource: event.resource, event_type: event.event_type, id: event.id },
  );
  const one = enqueueVerifiedWebhook({ events: {}, pending: [] }, a);
  const two = enqueueVerifiedWebhook(one.state, b);
  assert.equal(two.duplicate, true);
  assert.equal(two.state.pending.length, 1);
});
test("same id with altered payload fails closed", async () => {
  const a = await verifyAndPlanWebhook(client, {}, event);
  const b = await verifyAndPlanWebhook(
    client,
    {},
    { ...event, resource: { id: "another" } },
  );
  assert.throws(
    () =>
      enqueueVerifiedWebhook(
        enqueueVerifiedWebhook({ events: {}, pending: [] }, a).state,
        b,
      ),
    { code: "WEBHOOK_EVENT_ID_CONFLICT" },
  );
});
test("unknown IDs are retained for investigation not silently discarded", async () => {
  const a = await verifyAndPlanWebhook(
    client,
    {},
    { ...event, resource: { id: "cap1" } },
  );
  assert.equal(a.action.kind, WebhookActionKind.RecordUnmatched);
});
test("reversals and dispute resolutions hold, never guess automatic release", async () => {
  for (const event_type of [
    "PAYMENT.CAPTURE.REVERSED",
    "PAYMENT.CAPTURE.REFUNDED",
    "CUSTOMER.DISPUTE.RESOLVED",
  ]) {
    const a = await verifyAndPlanWebhook(
      client,
      {},
      {
        id: event_type,
        event_type,
        resource: {
          id: "cap",
          disputed_transactions: [{ seller_transaction_id: "cap" }],
        },
      },
    );
    assert.equal(a.action.kind, WebhookActionKind.HoldCapture);
  }
});
test("capture reconciliation checks amount reference order capture and status", async () => {
  const capture = {
    id: "cap",
    orderId: "order",
    reference: "payment",
    amountCents: 100,
    currency: "USD",
    status: "COMPLETED",
  };
  const expected = {
    orderId: "order",
    captureId: "cap",
    reference: "payment",
    amountCents: 100,
    currency: "USD" as const,
  };
  assert.equal(
    (
      await reconcileCapture(
        { getOrder: async () => ({ status: "COMPLETED", capture }) },
        expected,
      )
    ).confirmed,
    true,
  );
  for (const changed of [
    { amountCents: 101 },
    { reference: "other" },
    { id: "wrong" },
    { currency: "EUR" },
  ])
    await assert.rejects(
      reconcileCapture(
        {
          getOrder: async () => ({
            status: "COMPLETED",
            capture: { ...capture, ...changed },
          }),
        },
        expected,
      ),
      { code: "CAPTURE_MISMATCH" },
    );
  assert.equal(
    (
      await reconcileCapture(
        {
          getOrder: async () => ({
            status: "COMPLETED",
            capture: { ...capture, status: "PENDING" },
          }),
        },
        expected,
      )
    ).confirmed,
    false,
  );
});
test("provider failure leaves persisted inbox available to retry", async () => {
  const a = await verifyAndPlanWebhook(client, {}, event);
  const state = enqueueVerifiedWebhook({ events: {}, pending: [] }, a).state;
  await assert.rejects(
    reconcileCapture(
      {
        getOrder: async () => {
          throw new Error("temporary");
        },
      },
      {
        orderId: "order",
        reference: "payment",
        amountCents: 100,
        currency: "USD",
      },
    ),
  );
  assert.equal(state.pending.length, 1);
});

const refundEvent = {
  id: "WH-8HU03054XT607883S-368388653L941641N",
  event_type: "PAYMENT.CAPTURE.REFUNDED",
  resource: {
    id: "6F067495EH305030E",
    links: [
      {
        href: "https://api.sandbox.paypal.com/v2/payments/refunds/6F067495EH305030E",
        rel: "self",
        method: "GET",
      },
      {
        href: "https://api.sandbox.paypal.com/v2/payments/captures/05682940JT397591R",
        rel: "up",
        method: "GET",
      },
    ],
  },
};
test("real refund payload holds its parent capture, not its refund ID; duplicates stay idempotent", async () => {
  const plan = await verifyAndPlanWebhook(client, {}, refundEvent);
  assert.equal(plan.action.providerId, "05682940JT397591R");
  assert.equal(plan.action.refundId, "6F067495EH305030E");
  assert.equal(plan.action.captureProvenance, "parent_link");
  assert.equal(plan.action.kind, WebhookActionKind.HoldCapture);
  const first = enqueueVerifiedWebhook({ events: {}, pending: [] }, plan);
  assert.equal(
    enqueueVerifiedWebhook(first.state, plan).state.pending.length,
    1,
  );
});
test("unknown and hostile refund parent links retain a blocking hold without guessing", async () => {
  for (const href of [
    undefined,
    "https://api.sandbox.paypal.com.evil.test/v2/payments/captures/CAP",
    "https://evil@api.sandbox.paypal.com/v2/payments/captures/CAP",
    "https://api.sandbox.paypal.com:443/v2/payments/captures/CAP",
    "https://api.paypal.com/v2/payments/captures/CAP",
    "http://api.sandbox.paypal.com/v2/payments/captures/CAP",
    "https://api.sandbox.paypal.com/v2/payments/refunds/CAP",
    "https://api.sandbox.paypal.com/v2/payments/captures/CAP?x=1",
    "https://api.sandbox.paypal.com/v2/payments/captures/%43AP",
    "https://api.sandbox.paypal.com/v2/payments/captures/../captures/CAP",
  ]) {
    const plan = await verifyAndPlanWebhook(
      client,
      {},
      {
        ...refundEvent,
        resource: {
          id: refundEvent.resource.id,
          links: href ? [{ rel: "up", href }] : [],
        },
      },
    );
    assert.equal(plan.action.kind, WebhookActionKind.HoldCapture);
    assert.equal(plan.action.providerId, undefined, String(href));
  }
});
test("sandbox alias accepted; contradictory parent evidence rejected", async () => {
  const parent = refundEvent.resource.links[1];
  const plan = await verifyAndPlanWebhook(
    client,
    {},
    {
      ...refundEvent,
      resource: {
        id: refundEvent.resource.id,
        links: [{ ...parent, href: parent.href.replace("api.", "api-m.") }],
      },
    },
  );
  assert.equal(plan.action.providerId, "05682940JT397591R");
  const conflict = await verifyAndPlanWebhook(
    client,
    {},
    {
      ...refundEvent,
      resource: {
        ...refundEvent.resource,
        supplementary_data: { related_ids: { capture_id: "OTHER" } },
      },
    },
  );
  assert.equal(conflict.action.providerId, undefined);
  assert.equal(conflict.action.kind, WebhookActionKind.HoldCapture);
});

test("repair requires precise legacy refund identity and verified capture provenance", async () => {
  const next = (await verifyAndPlanWebhook(client, {}, refundEvent)).action;
  const old = {
    kind: WebhookActionKind.HoldCapture,
    eventId: next.eventId,
    eventType: next.eventType,
    providerId: next.refundId,
  };
  assert.equal(canRepairRefundPlan(old, next), true);
  for (const change of [
    { providerId: "OTHER" },
    { eventId: "OTHER" },
    { eventType: "PAYMENT.CAPTURE.REVERSED" },
    { captureProvenance: "parent_link" as const },
  ])
    assert.equal(canRepairRefundPlan({ ...old, ...change }, next), false);
  assert.equal(
    canRepairRefundPlan(old, { ...next, captureProvenance: undefined }),
    false,
  );
});

test("all invoicing lifecycle events plan a fresh invoice read with strict provider identity", async () => {
  for (const suffix of [
    "CREATED",
    "SENT",
    "CANCELLED",
    "PAID",
    "REFUNDED",
    "UPDATED",
    "SCHEDULED",
  ]) {
    const planned = await verifyAndPlanWebhook(
      client,
      {},
      {
        id: `invoice-${suffix}`,
        event_type: `INVOICING.INVOICE.${suffix}`,
        resource: {
          id: "INV2-EXAMPLE-1234",
          status: "PAID",
          amount: { value: "999999.99" },
        },
      },
    );
    assert.equal(planned.action.kind, WebhookActionKind.ReconcileInvoice);
    assert.equal(planned.action.providerId, "INV2-EXAMPLE-1234");
    assert.equal(Object.hasOwn(planned.action, "amount"), false);
  }
  for (const id of [undefined, "CAPTURE1", "INV2-../../evil", "INV2-"]) {
    const planned = await verifyAndPlanWebhook(
      client,
      {},
      {
        id: "bad-invoice",
        event_type: "INVOICING.INVOICE.PAID",
        resource: { id },
      },
    );
    assert.equal(planned.action.kind, WebhookActionKind.RecordUnmatched);
  }
});

test("v2 declined capture and checkout approval reversal retain blocking holds", async () => {
  const declined = await verifyAndPlanWebhook(
    client,
    {},
    { ...event, event_type: "PAYMENT.CAPTURE.DECLINED" },
  );
  assert.equal(declined.action.kind, WebhookActionKind.HoldCapture);
  assert.equal(declined.action.providerId, "cap1");
  const reversed = await verifyAndPlanWebhook(
    client,
    {},
    {
      id: "reversed",
      event_type: "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
      resource: { order_id: "ORDER1", id: "NOT-AN-ORDER" },
    },
  );
  assert.equal(reversed.action.kind, WebhookActionKind.HoldCapture);
  assert.equal(reversed.action.orderId, "ORDER1");
  assert.equal(
    reversed.action.providerId,
    undefined,
    "an order ID is not a capture ID",
  );
});

test("checkout lifecycle reads and refund lifecycle reads never request money writes", async () => {
  for (const suffix of ["APPROVED", "COMPLETED"]) {
    const plan = await verifyAndPlanWebhook(
      client,
      {},
      {
        id: suffix,
        event_type: `CHECKOUT.ORDER.${suffix}`,
        resource: { id: "ORDER1" },
      },
    );
    assert.equal(plan.action.kind, WebhookActionKind.ReconcileOrder);
    assert.equal(plan.action.orderId, "ORDER1");
  }
  for (const suffix of ["PENDING", "FAILED"]) {
    const plan = await verifyAndPlanWebhook(
      client,
      {},
      {
        id: suffix,
        event_type: `PAYMENT.REFUND.${suffix}`,
        resource: { id: "REFUND1" },
      },
    );
    assert.equal(plan.action.kind, WebhookActionKind.ReconcileRefund);
    assert.equal(plan.action.providerId, "REFUND1");
  }
});

test("batch and item payout event names both reconcile the actual batch ID", async () => {
  for (const [prefix, suffixes] of [
    ["PAYMENT.PAYOUTSBATCH", ["DENIED", "PROCESSING", "SUCCESS"]],
    [
      "PAYMENT.PAYOUTS-ITEM",
      [
        "BLOCKED",
        "CANCELED",
        "FAILED",
        "HELD",
        "REFUNDED",
        "RETURNED",
        "SUCCEEDED",
        "UNCLAIMED",
      ],
    ],
  ] as const) {
    for (const suffix of suffixes) {
      const event_type = `${prefix}.${suffix}`;
      for (const resource of [
        { payout_batch_id: "BATCH1" },
        { batch_header: { payout_batch_id: "BATCH1" } },
      ]) {
        const plan = await verifyAndPlanWebhook(
          client,
          {},
          { id: event_type, event_type, resource },
        );
        assert.equal(plan.action.kind, WebhookActionKind.ReconcilePayout);
        assert.equal(plan.action.providerId, "BATCH1");
      }
    }
  }
  const plan = await verifyAndPlanWebhook(
    client,
    {},
    {
      id: "missing-batch",
      event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      resource: { id: "ITEM1" },
    },
  );
  assert.equal(plan.action.kind, WebhookActionKind.RecordUnmatched);
});

test("every disputed capture is held and malformed transaction identity cannot be dropped", async () => {
  const dispute = {
    id: "dispute",
    event_type: "CUSTOMER.DISPUTE.CREATED",
    resource: {
      disputed_transactions: [
        { seller_transaction_id: "CAP1" },
        { seller_transaction_id: "CAP2" },
        { seller_transaction_id: "CAP1" },
      ],
    },
  };
  const plan = await verifyAndPlanWebhook(client, {}, dispute);
  assert.deepEqual(plan.action.providerIds, ["CAP1", "CAP2"]);
  const malformed = await verifyAndPlanWebhook(
    client,
    {},
    {
      ...dispute,
      resource: {
        disputed_transactions: [{ seller_transaction_id: "CAP1" }, {}],
      },
    },
  );
  assert.equal(malformed.action.kind, WebhookActionKind.HoldCapture);
  assert.deepEqual(malformed.action.providerIds, []);
  assert.equal(malformed.action.providerId, undefined);
});

test("every unsupported event is retained, including unused product events", async () => {
  for (const event_type of [
    "INVOICING.INVOICE.UNKNOWN",
    "PAYMENT.CAPTURE.UNKNOWN",
    "PAYMENT.REFUND.UNKNOWN",
    "CHECKOUT.UNKNOWN",
    "PAYMENT.PAYOUTSBATCH.UNKNOWN",
    "PAYMENT.PAYOUTS-ITEM.UNKNOWN",
    "CUSTOMER.DISPUTE.UNKNOWN",
  ]) {
    const plan = await verifyAndPlanWebhook(
      client,
      {},
      { id: event_type, event_type },
    );
    assert.equal(plan.action.kind, WebhookActionKind.RecordUnmatched);
    assert.equal(plan.action.reason, "UNSUPPORTED_WEBHOOK_EVENT");
  }
  const ignored = await verifyAndPlanWebhook(
    client,
    {},
    { id: "unused", event_type: "BILLING.SUBSCRIPTION.CREATED" },
  );
  assert.equal(ignored.action.kind, WebhookActionKind.RecordUnmatched);
  assert.equal(ignored.action.reason, "UNSUPPORTED_WEBHOOK_EVENT");
});

test("replanning an acknowledged ignore requires identical event identity and a newly actionable plan", async () => {
  const { canRepairUnsupportedPlan } = await import("../src/webhooks.js");
  const next = (
    await verifyAndPlanWebhook(
      client,
      {},
      {
        id: "old-invoice",
        event_type: "INVOICING.INVOICE.PAID",
        resource: { id: "INV2-EXAMPLE" },
      },
    )
  ).action;
  const old = {
    kind: WebhookActionKind.Ignore,
    eventId: next.eventId,
    eventType: next.eventType,
  };
  assert.equal(canRepairUnsupportedPlan(old, next), true);
  assert.equal(
    canRepairUnsupportedPlan({ ...old, eventId: "other" }, next),
    false,
  );
  assert.equal(
    canRepairUnsupportedPlan(
      { ...old, eventType: "INVOICING.INVOICE.CREATED" },
      next,
    ),
    false,
  );
  const unsupported = {
    ...old,
    kind: WebhookActionKind.RecordUnmatched,
    reason: "UNSUPPORTED_WEBHOOK_EVENT",
  };
  assert.equal(canRepairUnsupportedPlan(unsupported, next), true);
  assert.equal(canRepairUnsupportedPlan(unsupported, unsupported), false);
  assert.equal(
    canRepairUnsupportedPlan(
      { ...unsupported, reason: "UNMATCHED_EVENT" },
      next,
    ),
    false,
  );
  assert.equal(canRepairUnsupportedPlan(next, next), false);
  assert.equal(canRepairUnsupportedPlan(old, old), false);
});

test("every event in the subscription manifest has an implemented non-wildcard handler", async () => {
  const { readFileSync } = await import("node:fs");
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        "../../../deploy/paypal/webhook-event-types.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const names = manifest.event_types.map(
    (entry: { name: string }) => entry.name,
  );
  assert.equal(names.length, 37);
  assert.equal(new Set(names).size, names.length);
  for (const event_type of names) {
    const plan = await verifyAndPlanWebhook(
      client,
      {},
      {
        id: `manifest-${event_type}`,
        event_type,
        resource: {
          id: event_type.startsWith("INVOICING.")
            ? "INV2-EXAMPLE"
            : "RESOURCE1",
          order_id: "ORDER1",
          invoice_number: "INV2-EXAMPLE",
          sale_id: "CAP1",
          payout_batch_id: "BATCH1",
          supplementary_data: {
            related_ids: { order_id: "ORDER1", capture_id: "CAP1" },
          },
          disputed_transactions: [{ seller_transaction_id: "CAP1" }],
        },
      },
    );
    assert.notEqual(plan.action.kind, WebhookActionKind.Ignore, event_type);
    assert.notEqual(
      plan.action.kind,
      WebhookActionKind.RecordUnmatched,
      event_type,
    );
    assert.notEqual(
      plan.action.reason,
      "UNSUPPORTED_WEBHOOK_EVENT",
      event_type,
    );
  }
});

test("invoice sale completion is only a lookup hint, while sale adverse events preserve holds", async () => {
  const completed = await verifyAndPlanWebhook(
    client,
    {},
    {
      id: "sale-done",
      event_type: "PAYMENT.SALE.COMPLETED",
      resource: { id: "SALE1", invoice_number: "INV2-EXAMPLE" },
    },
  );
  assert.equal(completed.action.kind, WebhookActionKind.ReconcileInvoice);
  assert.equal(completed.action.providerId, "INV2-EXAMPLE");
  const unlinked = await verifyAndPlanWebhook(
    client,
    {},
    {
      id: "sale-unlinked",
      event_type: "PAYMENT.SALE.COMPLETED",
      resource: { id: "SALE1", invoice_number: "CUSTOM-NUMBER" },
    },
  );
  assert.equal(unlinked.action.kind, WebhookActionKind.RecordUnmatched);
  for (const suffix of ["PENDING", "DENIED", "REVERSED"]) {
    const plan = await verifyAndPlanWebhook(
      client,
      {},
      {
        id: suffix,
        event_type: `PAYMENT.SALE.${suffix}`,
        resource: { id: "SALE1" },
      },
    );
    assert.equal(plan.action.kind, WebhookActionKind.HoldCapture);
    assert.equal(plan.action.providerId, "SALE1");
  }
});

test("sale refunds hold only explicit original sale identity, never the refund ID", async () => {
  for (const resource of [
    { id: "REF1", sale_id: "SALE1" },
    {
      id: "REF1",
      links: [
        {
          rel: "up",
          method: "GET",
          href: "https://api.sandbox.paypal.com/v1/payments/sale/SALE1",
        },
      ],
    },
  ]) {
    const plan = await verifyAndPlanWebhook(
      client,
      {},
      { id: "sale-refund", event_type: "PAYMENT.SALE.REFUNDED", resource },
    );
    assert.equal(plan.action.kind, WebhookActionKind.HoldCapture);
    assert.equal(plan.action.providerId, "SALE1");
    assert.equal(plan.action.refundId, "REF1");
  }
  for (const resource of [
    { id: "REF1" },
    {
      id: "REF1",
      sale_id: "SALE1",
      links: [
        {
          rel: "up",
          href: "https://api.sandbox.paypal.com/v1/payments/sale/OTHER",
        },
      ],
    },
    {
      id: "REF1",
      links: [
        {
          rel: "up",
          href: "https://api.sandbox.paypal.com.evil.test/v1/payments/sale/SALE1",
        },
      ],
    },
  ]) {
    const plan = await verifyAndPlanWebhook(
      client,
      {},
      {
        id: "unmatched-sale-refund",
        event_type: "PAYMENT.SALE.REFUNDED",
        resource,
      },
    );
    assert.equal(plan.action.kind, WebhookActionKind.HoldCapture);
    assert.equal(plan.action.providerId, undefined);
  }
});

test("capture completion retains a strict invoice lookup hint without inventing an order", async () => {
  for (const supplementary_data of [
    undefined,
    { related_ids: { order_id: "ORDER1" } },
  ]) {
    const plan = await verifyAndPlanWebhook(
      client,
      {},
      {
        id: "invoice-capture",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP1",
          invoice_id: "INV2-EXAMPLE",
          supplementary_data,
        },
      },
    );
    assert.equal(plan.action.kind, WebhookActionKind.ReconcileCapture);
    assert.equal(plan.action.providerId, "CAP1");
    assert.equal(plan.action.invoiceId, "INV2-EXAMPLE");
    assert.equal(plan.action.orderId, supplementary_data?.related_ids.order_id);
  }
  const custom = await verifyAndPlanWebhook(
    client,
    {},
    {
      id: "custom-capture",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "CAP1", invoice_id: "CUSTOM-NUMBER" },
    },
  );
  assert.equal(custom.action.kind, WebhookActionKind.RecordUnmatched);
  assert.equal(custom.action.invoiceId, undefined);
});
