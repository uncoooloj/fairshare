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
export function refundBlocked(
  payment: any,
  payouts: any[],
  refunds: any[],
  held: boolean,
): string | null {
  if (payment.invoice_id)
    return "Invoice refunds must be handled in PayPal, then checked using the invoice status action. They are not supported here.";
  if (refunds.some((r) => r.payment_id === payment.id))
    return "A refund is already recorded. Check its status below; do not submit another.";
  if (payment.status !== "ALLOCATED" || !payment.provider_capture_id)
    return "Wait until this payment has been split.";
  const blockingPayout = payouts.find(
    (p) =>
      p.capture_id === payment.provider_capture_id &&
      !(
        ["WAITING_RECIPIENT", "AUTO_HELD", "RESERVED", "HELD"].includes(
          p.status,
        ) &&
        p.batch_id === null &&
        p.item_id === null
      ),
  );
  if (blockingPayout)
    return blockingPayout.batch_id ||
      blockingPayout.item_id ||
      blockingPayout.status === "SUBMITTING"
      ? "A payout has already started from this payment. Sort out the shares before refunding; we can’t pull money back."
      : "A payout has been reserved from this payment. Sort out the shares before refunding; we can’t pull money back.";
  if (held)
    return "This agreement is on hold. A new refund cannot be submitted.";
  return null;
}
export function refundMessage(status: string) {
  if (status === "COMPLETED")
    return "Refunded. Payouts stay paused until you check the shares.";
  if (status === "OUTCOME_UNKNOWN")
    return "Not sure the refund went through. Don’t refund again; check its status below.";
  if (status === "FAILED" || status === "CANCELLED")
    return "The refund hasn’t completed. Check its PayPal status below before taking another action. The agreement stays on hold.";
  return "The refund is recorded, but PayPal hasn’t confirmed completion. Check its status below; the agreement stays on hold.";
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
