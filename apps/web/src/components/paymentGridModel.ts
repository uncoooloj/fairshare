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
  Unknown = "UNKNOWN",
}
export interface PaymentGridRow {
  /** Stable internal key; may include agreement scope to avoid cross-agreement collisions. */
  id: string;
  /** Provider-facing payout operation identifier shown in exports and details. */
  payoutId: string;
  agreementId: string;
  agreementName: string;
  recipientName: string;
  amountCents: number;
  currency: "USD";
  status: PaymentGridStatus;
  createdAt?: string;
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
  UNKNOWN: "Needs reconciliation",
};
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
      !row.agreementName ||
      !row.recipientName ||
      !Number.isSafeInteger(row.amountCents) ||
      row.amountCents < 0 ||
      row.currency !== "USD" ||
      !Object.values(PaymentGridStatus).includes(row.status) ||
      (row.createdAt !== undefined &&
        !Number.isFinite(Date.parse(row.createdAt)))
    ) {
      throw new Error("Invalid payment grid data");
    }
    ids.add(row.id);
    return { ...row };
  });
}
