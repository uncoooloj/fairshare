import { formatMoney } from "./preferences";
import { parseCents } from "./model";
export function recoveryRequest(
  kind: "payment" | "payout" | "refund",
  operationId: string,
  evidence: string,
) {
  const providerId = evidence.trim();
  if (!/^[A-Za-z0-9._:-]{1,108}$/.test(providerId))
    throw new Error("Enter the exact PayPal sandbox reference, not a URL.");
  return {
    path: `${kind === "payment" ? "payments" : kind === "payout" ? "payouts" : "refunds"}/${encodeURIComponent(operationId)}/recover`,
    body: {
      [kind === "payment"
        ? "providerOrderId"
        : kind === "payout"
          ? "providerBatchId"
          : "providerRefundId"]: providerId,
    },
  };
}
/** Payout rows that never reached PayPal and are not reserved for sending (mirrors the API). */
const UNSENT_PAYOUT = [
  "WAITING_RECIPIENT",
  "AUTO_HELD",
  "HELD",
  "CANCELLED_FOR_REFUND",
];
/** A refund still moving money: it blocks another refund on the same payment. */
export function refundUnsettled(refund: {
  status: string;
  applied_at?: string | null;
}): boolean {
  return !refund.applied_at && !["FAILED", "CANCELLED"].includes(refund.status);
}
/** What can still be refunded here: the payment less every refund that may have gone through. */
export function refundableCents(
  payment: { id: string; amount: number },
  refunds: { payment_id: string; amount: number; status: string }[],
): number {
  return Math.max(
    0,
    payment.amount -
      refunds
        .filter(
          (r) =>
            r.payment_id === payment.id &&
            !["FAILED", "CANCELLED"].includes(r.status),
        )
        .reduce((sum, r) => sum + r.amount, 0),
  );
}
/** Dollars typed by the organizer to whole cents, between 1 cent and what is left. */
export function parseRefundAmount(text: string, maxCents: number): number {
  const cents = parseCents(text.replace(/^\$/, ""));
  if (cents < 1) throw new Error("Enter an amount above zero.");
  if (cents > maxCents)
    throw new Error(`You can refund up to ${formatMoney(maxCents)}.`);
  return cents;
}
export function refundBlocked(
  payment: any,
  payouts: any[],
  refunds: any[],
  held: boolean,
): string | null {
  if (payment.invoice_id)
    return "Invoice refunds must be handled in PayPal, then checked using the invoice status action. They are not supported here.";
  if (refunds.some((r) => r.payment_id === payment.id && refundUnsettled(r)))
    return "A refund on this payment is still going through. Check its status below before refunding more.";
  if (payment.status !== "ALLOCATED" || !payment.provider_capture_id)
    return "Wait until this payment has been split.";
  const blockingPayout = payouts.find(
    (p) =>
      p.capture_id === payment.provider_capture_id &&
      !(
        UNSENT_PAYOUT.includes(p.status) &&
        p.batch_id === null &&
        p.item_id === null
      ),
  );
  if (blockingPayout)
    return blockingPayout.batch_id ||
      blockingPayout.item_id ||
      blockingPayout.status !== "RESERVED"
      ? "A payout has already started from this payment, so it can’t be refunded here. Refund it in PayPal and payouts will pause so you can review who was paid."
      : "A payout from this payment is about to go out, so it can’t be refunded here. Refund it in PayPal and payouts will pause so you can review who was paid.";
  if (held)
    return "Payouts are paused. Review the refund before refunding more.";
  if (refundableCents(payment, refunds) < 1)
    return "This payment has been fully refunded.";
  return null;
}
/** Where an organizer refund stands; values match the API's RefundOutcome. */
export enum RefundOutcome {
  REVERSED_BY_SPLIT = "REVERSED_BY_SPLIT",
  PAUSED_FOR_REVIEW = "PAUSED_FOR_REVIEW",
  WAITING_FOR_PAYPAL = "WAITING_FOR_PAYPAL",
  NOT_REFUNDED = "NOT_REFUNDED",
}
export function refundMessage(status: string, outcome?: RefundOutcome) {
  if (status === "COMPLETED")
    return outcome === RefundOutcome.PAUSED_FOR_REVIEW
      ? "Refunded. Payouts are paused so you can review who was paid."
      : "Refunded. It came back out of everyone’s split for this payment.";
  if (status === "OUTCOME_UNKNOWN")
    return "Not sure the refund went through. Don’t refund again; check its status below.";
  if (status === "FAILED" || status === "CANCELLED")
    return "The refund didn’t go through. Nobody’s split changed.";
  return "PayPal hasn’t confirmed the refund yet. Payouts from this payment wait until it does.";
}

/** Ignore repeat submissions synchronously; release the lock even after failure. */
export function createSingleFlight() {
  let inFlight = false;
  return async (action: () => Promise<void>) => {
    if (inFlight) return;
    inFlight = true;
    try {
      await action();
    } finally {
      inFlight = false;
    }
  };
}

export function paymentReconcilePath(payment: {
  id: string;
  invoice_id?: string | null;
}) {
  return payment.invoice_id
    ? `invoices/${encodeURIComponent(payment.invoice_id)}/reconcile`
    : `payments/${encodeURIComponent(payment.id)}/reconcile`;
}

export function refundablePayments<
  T extends { id: string; invoice_id?: string | null },
>(payments: T[]): T[] {
  return payments.filter((payment) => !payment.invoice_id);
}
