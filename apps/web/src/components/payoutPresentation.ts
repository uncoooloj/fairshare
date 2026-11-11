import {
  paymentStatusLabels,
  PaymentGridStatus,
  validatePaymentRows,
  type PaymentGridRow,
} from "./paymentGridModel";
export const payoutGuidance: Record<PaymentGridStatus, string> = {
  PAID: "PayPal says this arrived.",
  PENDING: "Pending. Don’t send it again.",
  PROCESSING: "PayPal is processing this. Don’t send it again.",
  HELD: "Paused. Check the agreement before doing anything.",
  FAILED:
    "This payout failed. Check the person’s PayPal details, then try again from the agreement.",
  UNCLAIMED: "They haven’t collected this in PayPal yet.",
  REVERSED: "PayPal reversed this, so it doesn’t count as paid.",
  UNKNOWN:
    "We’re not sure this went through. Don’t send it again; check it in PayPal.",
};

function payoutSearchText(row: PaymentGridRow) {
  return [
    row.agreementName,
    row.recipientName,
    row.providerReference ?? "",
    paymentStatusLabels[row.status],
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function filterPayouts(
  rows: readonly PaymentGridRow[],
  status: PaymentGridStatus | "",
  query: string,
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (status && row.status !== status) return false;
    if (!terms.length) return true;
    const searchText = payoutSearchText(row);
    return terms.every((term) => searchText.includes(term));
  });
}
function csvCell(value: string) {
  // Spreadsheet formulas can start after whitespace. Always quote and neutralize user-controlled formulas.
  const safe =
    /^[\s]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function payoutCsv(rows: readonly PaymentGridRow[]) {
  const records = validatePaymentRows(rows).map((row) => [
    row.payoutId,
    row.agreementName,
    row.recipientName,
    `${Math.floor(row.amountCents / 100)}.${String(row.amountCents % 100).padStart(2, "0")}`,
    row.currency,
    paymentStatusLabels[row.status],
    row.createdAt ?? "",
    row.providerReference ?? "",
  ]);
  return [
    [
      "Payout ID",
      "Agreement",
      "Person",
      "Amount",
      "Currency",
      "Status",
      "Created",
      "PayPal reference",
    ],
    ...records,
  ]
    .map((record) => record.map(csvCell).join(","))
    .join("\r\n");
}
