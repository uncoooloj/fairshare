import { createHash } from "node:crypto";
import { PayPalError, PayPalSandbox } from "./paypal.js";
export enum WebhookActionKind {
  ReconcileCapture = "RECONCILE_CAPTURE",
  HoldCapture = "HOLD_CAPTURE",
  ReconcilePayout = "RECONCILE_PAYOUT",
  RecordUnmatched = "RECORD_UNMATCHED",
  Ignore = "IGNORE",
}
export type WebhookAction = {
  kind: WebhookActionKind;
  eventId: string;
  eventType: string;
  providerId?: string;
  orderId?: string;
  reason?: string;
};
export type VerifiedWebhook = {
  eventId: string;
  fingerprint: string;
  action: WebhookAction;
};
type Event = {
  id?: unknown;
  event_type?: unknown;
  resource?: Record<string, any>;
};
const text = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= 256 ? v : undefined;
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
/** Caller must persist this action and event receipt atomically. Webhooks do NOT directly credit or pay funds. */
export async function verifyAndPlanWebhook(
  client: Pick<PayPalSandbox, "verifyWebhook">,
  headers: Record<string, string | string[] | undefined>,
  event: unknown,
): Promise<VerifiedWebhook> {
  if (!(await client.verifyWebhook(headers, event)))
    throw new PayPalError("INVALID_WEBHOOK_SIGNATURE", 401);
  const e = event as Event,
    eventId = text(e?.id),
    eventType = text(e?.event_type);
  if (!eventId || !eventType)
    throw new PayPalError("INVALID_WEBHOOK_EVENT", 400);
  const r = e.resource ?? {};
  const captureId = text(r.id),
    orderId = text(r.supplementary_data?.related_ids?.order_id);
  let action: WebhookAction = {
    kind: WebhookActionKind.Ignore,
    eventId,
    eventType,
  };
  if (eventType === "PAYMENT.CAPTURE.COMPLETED")
    action = {
      ...action,
      kind: orderId
        ? WebhookActionKind.ReconcileCapture
        : WebhookActionKind.RecordUnmatched,
      providerId: captureId,
      orderId,
    };
  // Hold conservatively; exact matching of an app-reserved refund can resolve the hold downstream.
  else if (
    [
      "PAYMENT.CAPTURE.REFUNDED",
      "PAYMENT.CAPTURE.REVERSED",
      "PAYMENT.CAPTURE.DENIED",
      "PAYMENT.CAPTURE.PENDING",
    ].includes(eventType)
  )
    action = {
      ...action,
      kind: WebhookActionKind.HoldCapture,
      providerId: captureId,
      reason: eventType,
    };
  else if (eventType.startsWith("CUSTOMER.DISPUTE."))
    action = {
      ...action,
      kind: WebhookActionKind.HoldCapture,
      providerId: text(r.disputed_transactions?.[0]?.seller_transaction_id),
      reason: eventType,
    };
  else if (eventType.startsWith("PAYMENT.PAYOUTS-"))
    action = {
      ...action,
      kind: WebhookActionKind.ReconcilePayout,
      providerId:
        text(r.payout_batch_id) ?? text(r.batch_header?.payout_batch_id),
      reason: eventType,
    };
  if (action.kind !== WebhookActionKind.Ignore && !action.providerId)
    action = { ...action, kind: WebhookActionKind.RecordUnmatched };
  return {
    eventId,
    fingerprint: createHash("sha256").update(canonical(event)).digest("hex"),
    action,
  };
}
export type InboxState = {
  events: Record<string, string>;
  pending: WebhookAction[];
};
/** Pure transaction reducer. Persist its returned state once, alongside the domain journal. */
export function enqueueVerifiedWebhook(
  state: InboxState,
  event: VerifiedWebhook,
): { state: InboxState; duplicate: boolean } {
  const previous = Object.hasOwn(state.events, event.eventId)
    ? state.events[event.eventId]
    : undefined;
  if (previous) {
    if (previous !== event.fingerprint)
      throw new PayPalError("WEBHOOK_EVENT_ID_CONFLICT", 409);
    return { state, duplicate: true };
  }
  const events = { ...state.events };
  Object.defineProperty(events, event.eventId, {
    value: event.fingerprint,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return {
    state: { events, pending: [...state.pending, event.action] },
    duplicate: false,
  };
}
export type ExpectedCapture = {
  orderId: string;
  captureId?: string;
  reference: string;
  amountCents: number;
  currency: "USD";
};
/** Only a fresh matched provider read can become a revenue confirmation. */
export async function reconcileCapture(
  client: Pick<PayPalSandbox, "getOrder">,
  expected: ExpectedCapture,
) {
  const order = await client.getOrder(expected.orderId),
    c = order.capture;
  if (!c) return { confirmed: false as const, status: order.status };
  if (
    c.orderId !== expected.orderId ||
    c.reference !== expected.reference ||
    c.amountCents !== expected.amountCents ||
    c.currency !== expected.currency ||
    (expected.captureId && c.id !== expected.captureId)
  )
    throw new PayPalError("CAPTURE_MISMATCH", 409);
  return c.status === "COMPLETED"
    ? { confirmed: true as const, capture: c }
    : { confirmed: false as const, status: c.status };
}
