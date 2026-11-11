import {
  PaymentGridStatus,
  validatePaymentRows,
  type PaymentGridRow,
} from "./paymentGridModel";

/** Summaries describe recorded rows, never inferred settlement or a fabricated period. */
export function summarizePayouts(rows: readonly PaymentGridRow[]) {
  const result = {
    paid: 0,
    processing: 0,
    attention: 0,
    paidCount: 0,
    processingCount: 0,
    attentionCount: 0,
  };
  for (const row of validatePaymentRows(rows)) {
    const group =
      row.status === PaymentGridStatus.Paid
        ? "paid"
        : [PaymentGridStatus.Pending, PaymentGridStatus.Processing].includes(
              row.status,
            )
          ? "processing"
          : [
                PaymentGridStatus.Failed,
                PaymentGridStatus.Held,
                PaymentGridStatus.Unknown,
                PaymentGridStatus.Unclaimed,
                PaymentGridStatus.WaitingRecipient,
                PaymentGridStatus.Checking,
              ].includes(row.status)
            ? "attention"
            : null;
    if (group) {
      result[group] += row.amountCents;
      if (!Number.isSafeInteger(result[group]))
        throw new Error("Payout total exceeds safe integer range");
      result[`${group}Count`]++;
    }
  }
  return result;
}
