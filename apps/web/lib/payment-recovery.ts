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
  if (refunds.some((r) => r.payment_id === payment.id))
    return "A refund is already recorded. Check its status below; do not submit another.";
  if (payment.status !== "ALLOCATED" || !payment.provider_capture_id)
    return "A verified, allocated capture is required.";
  if (payouts.some((p) => p.capture_id === payment.provider_capture_id))
    return "A payout was reserved. Operator liability review is required; automatic clawback is not supported.";
  if (held)
    return "This agreement is on hold. A new refund cannot be submitted.";
  return null;
}
export function refundMessage(status: string) {
  if (status === "COMPLETED")
    return "PayPal verified the refund as completed. The agreement remains on hold and liabilities are retained for review.";
  if (status === "OUTCOME_UNKNOWN")
    return "The refund outcome is unknown. Do not retry. Check provider evidence below. The agreement remains on hold.";
  return "Refund recorded, not confirmed complete. Check the provider status below. The agreement remains on hold.";
}
