import {
  paymentStatusLabel,
  PaymentGridStatus,
  validatePaymentRows,
  type PaymentGridRow,
} from "./paymentGridModel";
import { formatDay, formatExact } from "../../lib/dates";

/** Payouts made before dates were stored have none; say so instead of guessing. */
export const NO_PAYOUT_DATE_HINT = "No date was recorded for this payout.";
/** "Nov 11" with the exact time as its tooltip, or "—" when no date was stored. */
export function payoutDate(value: string | undefined) {
  const exact = formatExact(value);
  return exact
    ? { label: formatDay(value), title: exact, recorded: true }
    : { label: "—", title: NO_PAYOUT_DATE_HINT, recorded: false };
}
/** A paid payout's last observed status update, not a provider send time. */
export function payoutSentLabel(
  row: Pick<PaymentGridRow, "status" | "updatedAt">,
) {
  return row.status === PaymentGridStatus.Paid && formatExact(row.updatedAt)
    ? `Status updated ${formatDay(row.updatedAt)}`
    : undefined;
}
export const payoutGuidance: Record<PaymentGridStatus, string> = {
  PAID: "PayPal says this arrived.",
  PENDING: "Pending. Don’t send it again.",
  PROCESSING: "PayPal is processing this. Don’t send it again.",
  HELD: "Paused. Check the agreement before doing anything.",
  FAILED:
    "This payout failed. Check the agreement and payout evidence before taking another action.",
  UNCLAIMED: "They haven’t collected this in PayPal yet.",
  REVERSED: "PayPal reversed this, so it doesn’t count as paid.",
  WAITING_RECIPIENT:
    "Nothing has been sent. The recipient’s PayPal details need to be added; their payout goes out after that.",
  RESERVED:
    "Nothing has been sent. This payout is ready to send when its dispatch runs.",
  CHECKING:
    "This payout may have reached PayPal. We are checking PayPal's record. Do not send it again.",
  UNKNOWN:
    "We’re not sure this went through. Don’t send it again; check it in PayPal.",
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
      "PayPal reference",
    ],
    ...records,
  ]
    .map((record) => record.map(csvCell).join(","))
    .join("\r\n");
}
