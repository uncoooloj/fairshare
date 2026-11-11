import {
  paymentStatusLabel,
  PaymentGridStatus,
  validatePaymentRows,
  type PaymentGridRow,
} from "./paymentGridModel";
export const payoutGuidance: Record<PaymentGridStatus, string> = {
  PAID: "The recorded provider status confirms this payout completed.",
  PENDING:
    "This payout is pending. It has not been confirmed complete; do not submit it again.",
  PROCESSING:
    "The provider is processing this payout. Wait for a verified status update rather than sending another transfer.",
  HELD: "This payout is on hold. Review the agreement and existing provider evidence before taking action.",
  FAILED:
    "The recorded payout failed. Review the provider record and agreement recovery options; this screen does not retry transfers.",
  UNCLAIMED:
    "The recipient has not claimed this payout. Unclaimed funds are not a completed transfer.",
  REVERSED:
    "The provider recorded a reversal. Do not count this payout as paid.",
  WAITING_RECIPIENT:
    "Nothing has been sent. This person needs to add the PayPal email they want to be paid at; their payout goes out after that.",
  CHECKING:
    "This payout may have reached PayPal. We are checking PayPal's record. Do not send it again.",
  UNKNOWN:
    "The outcome is uncertain. Verify existing provider evidence before any further action. Do not retry the transfer.",
};

function payoutSearchText(row: PaymentGridRow) {
  return [
    row.agreementName,
    row.recipientName,
    row.providerReference ?? "",
    paymentStatusLabel(row),
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
    paymentStatusLabel(row),
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
      "Provider reference",
    ],
    ...records,
  ]
    .map((record) => record.map(csvCell).join(","))
    .join("\r\n");
}
