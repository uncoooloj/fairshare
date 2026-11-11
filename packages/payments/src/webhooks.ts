import { createHash } from "node:crypto";
import { PayPalError, PayPalSandbox } from "./paypal.js";
export enum WebhookActionKind {
  ReconcileCapture = "RECONCILE_CAPTURE",
  ReconcileOrder = "RECONCILE_ORDER",
  ReconcileInvoice = "RECONCILE_INVOICE",
  ReconcileRefund = "RECONCILE_REFUND",
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
  providerIds?: string[];
  orderId?: string;
  invoiceId?: string;
  refundId?: string;
  captureProvenance?: "related_id" | "parent_link";
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
const disputeEvents = ["CREATED", "RESOLVED", "UPDATED"].map(
  (suffix) => `CUSTOMER.DISPUTE.${suffix}`,
);
const payoutEvents = [
  ...["DENIED", "PROCESSING", "SUCCESS"].map(
    (suffix) => `PAYMENT.PAYOUTSBATCH.${suffix}`,
  ),
  ...[
    "BLOCKED",
    "CANCELED",
    "FAILED",
    "HELD",
    "REFUNDED",
    "RETURNED",
    "SUCCEEDED",
    "UNCLAIMED",
  ].map((suffix) => `PAYMENT.PAYOUTS-ITEM.${suffix}`),
];
/** Refund resources have their own ID. Only explicit parent evidence identifies a capture. */
function refundCapture(
  resource: Record<string, any>,
  family: "capture" | "sale" = "capture",
): Pick<WebhookAction, "providerId" | "captureProvenance"> {
  const ids = new Set<string>();
  const related =
    family === "sale"
      ? resource.sale_id
      : resource.supplementary_data?.related_ids?.capture_id;
  if (related !== undefined) {
    if (typeof related !== "string" || !/^[A-Za-z0-9]+$/.test(related))
      return {};
    ids.add(related);
  }
  let parent = false;
  if (Array.isArray(resource.links)) {
    for (const link of resource.links) {
      if (link?.rel !== "up") continue;
      // Compare the raw URL too: URL normalization must not admit credentials,
      // encoded paths, dot segments, ports, queries, or untrusted lookalike hosts.
      const match =
        typeof link.href === "string" &&
        link.href.match(
          family === "sale"
            ? /^https:\/\/(?:api|api-m)\.sandbox\.paypal\.com\/v1\/payments\/sale\/([A-Za-z0-9]+)$/
            : /^https:\/\/(?:api|api-m)\.sandbox\.paypal\.com\/v2\/payments\/captures\/([A-Za-z0-9]+)$/,
        );
      if (!match || (link.method !== undefined && link.method !== "GET"))
        return {};
      ids.add(match[1]);
      parent = true;
    }
  }
  if (ids.size !== 1) return {};
  return {
    providerId: [...ids][0],
    captureProvenance: parent ? "parent_link" : "related_id",
  };
}

/** Only repair a pending legacy refund plan after the identical payload is reverified. */
export function canRepairRefundPlan(
  old: WebhookAction,
  next: WebhookAction,
): boolean {
  return (
    old.kind === WebhookActionKind.HoldCapture &&
    old.eventType === "PAYMENT.CAPTURE.REFUNDED" &&
    old.eventId === next.eventId &&
    next.eventType === old.eventType &&
    next.kind === WebhookActionKind.HoldCapture &&
    !!next.captureProvenance &&
    !!next.providerId &&
    !!next.refundId &&
    !old.captureProvenance &&
    old.providerId === next.refundId
  );
}
/** Caller must first verify the signature and match the stored payload fingerprint.
 * Previously ignored events have no applied effects and can be safely replanned.
 * Never reopen a completed actionable event or change its identity. */
export function canRepairUnsupportedPlan(
  old: WebhookAction,
  next: WebhookAction,
) {
  return (
    old.eventId === next.eventId &&
    old.eventType === next.eventType &&
    ((old.kind === WebhookActionKind.Ignore &&
      next.kind !== WebhookActionKind.Ignore) ||
      (old.kind === WebhookActionKind.RecordUnmatched &&
        old.reason === "UNSUPPORTED_WEBHOOK_EVENT" &&
        next.kind !== WebhookActionKind.Ignore &&
        next.kind !== WebhookActionKind.RecordUnmatched))
  );
}
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
  const invoiceReference = text(r.invoice_id);
  const invoiceId =
    invoiceReference && /^INV2-[A-Z0-9-]{1,64}$/.test(invoiceReference)
      ? invoiceReference
      : undefined;
  let action: WebhookAction = {
    kind: WebhookActionKind.RecordUnmatched,
    eventId,
    eventType,
    reason: "UNSUPPORTED_WEBHOOK_EVENT",
  };
  if (eventType === "PAYMENT.CAPTURE.COMPLETED")
    action = {
      ...action,
      kind:
        orderId || invoiceId
          ? WebhookActionKind.ReconcileCapture
          : WebhookActionKind.RecordUnmatched,
      providerId: captureId,
      orderId,
      invoiceId,
      reason: eventType,
    };
  // Hold conservatively; exact matching of an app-reserved refund can resolve the hold downstream.
  else if (
    ["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.SALE.REFUNDED"].includes(eventType)
  )
    action = {
      ...action,
      kind: WebhookActionKind.HoldCapture,
      refundId: captureId,
      ...refundCapture(
        r,
        eventType === "PAYMENT.SALE.REFUNDED" ? "sale" : "capture",
      ),
      orderId,
      reason: eventType,
    };
  else if (
    [
      "PAYMENT.CAPTURE.REVERSED",
      "PAYMENT.CAPTURE.DENIED",
      "PAYMENT.CAPTURE.DECLINED",
      "PAYMENT.CAPTURE.PENDING",
      "PAYMENT.SALE.DENIED",
      "PAYMENT.SALE.PENDING",
      "PAYMENT.SALE.REVERSED",
    ].includes(eventType)
  )
    action = {
      ...action,
      kind: WebhookActionKind.HoldCapture,
      providerId: captureId,
      orderId,
      reason: eventType,
    };
  else if (eventType === "PAYMENT.SALE.COMPLETED") {
    const invoiceId = text(r.invoice_number);
    action = {
      ...action,
      kind: WebhookActionKind.ReconcileInvoice,
      providerId:
        invoiceId && /^INV2-[A-Z0-9-]{1,64}$/.test(invoiceId)
          ? invoiceId
          : undefined,
      reason: eventType,
    };
  } else if (disputeEvents.includes(eventType)) {
    const transactions = Array.isArray(r.disputed_transactions)
      ? r.disputed_transactions
      : [];
    const ids = transactions.map((t: any) => text(t?.seller_transaction_id));
    const providerIds = ids.every(Boolean)
      ? ([...new Set(ids)] as string[])
      : [];
    action = {
      ...action,
      kind: WebhookActionKind.HoldCapture,
      providerId: providerIds[0],
      providerIds,
      reason: eventType,
    };
  } else if (payoutEvents.includes(eventType))
    action = {
      ...action,
      kind: WebhookActionKind.ReconcilePayout,
      providerId:
        text(r.payout_batch_id) ?? text(r.batch_header?.payout_batch_id),
      reason: eventType,
    };
  else if (
    ["PAYMENT.REFUND.PENDING", "PAYMENT.REFUND.FAILED"].includes(eventType)
  )
    action = {
      ...action,
      kind: WebhookActionKind.ReconcileRefund,
      providerId: captureId,
      reason: eventType,
    };
  else if (
    ["CHECKOUT.ORDER.APPROVED", "CHECKOUT.ORDER.COMPLETED"].includes(eventType)
  )
    action = {
      ...action,
      kind: WebhookActionKind.ReconcileOrder,
      providerId: captureId,
      orderId: captureId,
      reason: eventType,
    };
  else if (eventType === "CHECKOUT.PAYMENT-APPROVAL.REVERSED")
    action = {
      ...action,
      kind: WebhookActionKind.HoldCapture,
      // PayPal uses resource.order_id here, not the order resource's id shape.
      orderId: text(r.order_id),
      reason: eventType,
    };
  else if (
    [
      "CREATED",
      "SENT",
      "CANCELLED",
      "PAID",
      "REFUNDED",
      "UPDATED",
      "SCHEDULED",
    ].some((type) => eventType === `INVOICING.INVOICE.${type}`)
  )
    action = {
      ...action,
      kind: WebhookActionKind.ReconcileInvoice,
      providerId:
        captureId && /^INV2-[A-Z0-9-]{1,64}$/.test(captureId)
          ? captureId
          : undefined,
      reason: eventType,
    };
  if (
    action.kind !== WebhookActionKind.Ignore &&
    action.kind !== WebhookActionKind.HoldCapture &&
    !action.providerId
  )
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
