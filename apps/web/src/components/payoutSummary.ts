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
        : [
              PaymentGridStatus.Reserved,
              PaymentGridStatus.Pending,
              PaymentGridStatus.Processing,
            ].includes(row.status)
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

/** The three totals cards, in display order. */
export enum PayoutCardKind {
  Paid = "PAID",
  OnTheWay = "ON_THE_WAY",
  Attention = "ATTENTION",
}

export interface PayoutCard {
  kind: PayoutCardKind;
  label: string;
  amountCents: number;
  /** Short count line shown on the card, e.g. "1 payout paid". */
  caption: string;
  /** Longer explanation, kept behind the card's info button. */
  explanation: string;
}

/** "1 payout", "3 payouts". */
export function payoutCount(count: number): string {
  return `${count} ${count === 1 ? "payout" : "payouts"}`;
}

/** Card copy for the totals row: a count and a short label, details behind a tooltip. */
export function payoutCards(
  summary: ReturnType<typeof summarizePayouts>,
): PayoutCard[] {
  return [
    {
      kind: PayoutCardKind.Paid,
      label: "Paid out",
      amountCents: summary.paid,
      caption: `${payoutCount(summary.paidCount)} paid`,
      explanation: "PayPal marked these payouts as paid.",
    },
    {
      kind: PayoutCardKind.OnTheWay,
      label: "Pending",
      amountCents: summary.processing,
      caption: `${payoutCount(summary.processingCount)} pending`,
      explanation: "Waiting to be sent or for PayPal to confirm the result.",
    },
    {
      kind: PayoutCardKind.Attention,
      label: "Needs attention",
      amountCents: summary.attention,
      caption: `${summary.attentionCount} ${summary.attentionCount === 1 ? "needs" : "need"} attention`,
      explanation:
        "Payouts that failed, are on hold, weren't collected, are waiting for payout details, or are awaiting a confirmed result. Don't retry blindly.",
    },
  ];
}
