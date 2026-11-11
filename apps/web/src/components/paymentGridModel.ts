import type { AllocationTrace } from "../../lib/allocation-trace";
/** Read-only projection: amounts originate in the server's deterministic ledger. */
export enum PaymentGridStatus {
  Unclaimed = "UNCLAIMED",
  Pending = "PENDING",
  Held = "HELD",
  Processing = "PROCESSING",
  Paid = "PAID",
  Failed = "FAILED",
  Reversed = "REVERSED",
  /** Parked until this person adds a PayPal email. Nothing was sent. */
  WaitingRecipient = "WAITING_RECIPIENT",
  /** A send may have reached PayPal; we are reading PayPal's record. */
  Checking = "CHECKING",
  Unknown = "UNKNOWN",
}
export interface PaymentGridRow {
  /** Stable internal key; may include agreement scope to avoid cross-agreement collisions. */
  id: string;
  /** Provider-facing payout operation identifier shown in exports and details. */
  payoutId: string;
  agreementId: string;
  agreementKey: string;
  agreementName: string;
  recipientName: string;
  amountCents: number;
  currency: "USD";
  status: PaymentGridStatus;
  createdAt?: string;
  /** Last status change; for a paid payout, when it was sent. */
  updatedAt?: string;
  trace?: AllocationTrace;
  providerReference?: string;
}
export const paymentStatusLabels: Record<PaymentGridStatus, string> = {
  UNCLAIMED: "Unclaimed",
  PENDING: "Pending",
  HELD: "On hold",
  PROCESSING: "Processing",
  PAID: "Paid",
  FAILED: "Failed",
  REVERSED: "Reversed",
  WAITING_RECIPIENT: "Waiting for PayPal email",
  CHECKING: "Checking with PayPal",
  UNKNOWN: "Being checked",
};
/** The label for one row; names the person when we are waiting on them. */
export function paymentStatusLabel(
  row: Pick<PaymentGridRow, "status" | "recipientName">,
): string {
  return row.status === PaymentGridStatus.WaitingRecipient
    ? `Waiting for ${row.recipientName}'s PayPal email`
    : paymentStatusLabels[row.status];
}
/** Maps a stored payout operation status to what the grid shows. */
export function payoutGridStatus(status: string): PaymentGridStatus {
  if (status === "SUCCESS") return PaymentGridStatus.Paid;
  if (status === "UNCLAIMED") return PaymentGridStatus.Unclaimed;
  if (["FAILED", "DENIED", "BLOCKED"].includes(status))
    return PaymentGridStatus.Failed;
  if (["HELD", "ONHOLD", "AUTO_HELD"].includes(status))
    return PaymentGridStatus.Held;
  if (["REFUNDED", "REVERSED", "RETURNED"].includes(status))
    return PaymentGridStatus.Reversed;
  if (["SUBMITTING", "PROCESSING"].includes(status))
    return PaymentGridStatus.Processing;
  if (["PENDING", "RESERVED"].includes(status))
    return PaymentGridStatus.Pending;
  if (status === "WAITING_RECIPIENT") return PaymentGridStatus.WaitingRecipient;
  if (status === "OUTCOME_UNKNOWN") return PaymentGridStatus.Checking;
  return PaymentGridStatus.Unknown;
}
/** Kept for callers that import it from here; same mapping as `payoutGridStatus`. */
export function payoutStatus(status: string): PaymentGridStatus {
  return payoutGridStatus(status);
}
export function formatPaymentAmount(cents: number, currency: "USD"): string {
  if (!Number.isSafeInteger(cents) || cents < 0 || currency !== "USD")
    return "Invalid amount";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
}
export function validatePaymentRows(
  rows: readonly PaymentGridRow[],
): PaymentGridRow[] {
  const ids = new Set<string>();
  return rows.map((row) => {
    if (
      !row.id ||
      ids.has(row.id) ||
      !row.payoutId ||
      !row.agreementId ||
      !row.agreementKey ||
      !row.agreementName ||
      !row.recipientName ||
      !Number.isSafeInteger(row.amountCents) ||
      row.amountCents < 0 ||
      row.currency !== "USD" ||
      !Object.values(PaymentGridStatus).includes(row.status) ||
      [row.createdAt, row.updatedAt].some(
        (at) => at !== undefined && !Number.isFinite(Date.parse(at)),
      )
    ) {
      throw new Error("Invalid payment grid data");
    }
    ids.add(row.id);
    return { ...row };
  });
}
