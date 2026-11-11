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
