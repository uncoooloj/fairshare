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
    return "Wait until the payment is confirmed and its shares are calculated.";
  if (
    payouts.some(
      (p) =>
        p.capture_id === payment.provider_capture_id &&
        !(
          ["WAITING_RECIPIENT", "AUTO_HELD", "RESERVED", "HELD"].includes(
            p.status,
          ) &&
          p.batch_id === null &&
          p.item_id === null
        ),
    )
  )
    return "A payout has already started. The amounts owed need to be reviewed before a refund can be issued; sent payouts won’t be reversed automatically.";
  if (held)
    return "This agreement is on hold. A new refund cannot be submitted.";
  return null;
}
export function refundMessage(status: string) {
  if (status === "COMPLETED")
    return "PayPal confirmed the refund. The agreement stays on hold until the remaining amounts owed are reviewed.";
  if (status === "OUTCOME_UNKNOWN")
    return "We haven’t confirmed whether the refund went through. Don’t send another refund. Check its PayPal status below; the agreement stays on hold.";
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
