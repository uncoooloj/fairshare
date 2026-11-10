import { paymentStatusLabels, PaymentGridStatus, validatePaymentRows, type PaymentGridRow } from './paymentGridModel';
export const payoutGuidance: Record<PaymentGridStatus, string> = {
  PAID: 'The recorded provider status confirms this payout completed.',
  PENDING: 'This payout is pending. It has not been confirmed complete; do not submit it again.',
  PROCESSING: 'The provider is processing this payout. Wait for a verified status update rather than sending another transfer.',
  HELD: 'This payout is on hold. Review the agreement and existing provider evidence before taking action.',
  FAILED: 'The recorded payout failed. Review the provider record and agreement recovery options; this screen does not retry transfers.',
  UNCLAIMED: 'The recipient has not claimed this payout. Unclaimed funds are not a completed transfer.',
  REVERSED: 'The provider recorded a reversal. Do not count this payout as paid.',
  UNKNOWN: 'The outcome is uncertain. Verify existing provider evidence before any further action. Do not retry the transfer.',
};
export function filterPayouts(rows: readonly PaymentGridRow[], status: PaymentGridStatus | '', query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => (!status || row.status === status) && terms.every(term =>
    [row.agreementName, row.recipientName, row.providerReference ?? '', paymentStatusLabels[row.status]].join(' ').toLocaleLowerCase().includes(term)));
}
function csvCell(value: string) {
  // Spreadsheet formulas can start after whitespace. Always quote and neutralize user-controlled formulas.
  const safe = /^[\s]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function payoutCsv(rows: readonly PaymentGridRow[]) {
  const records = validatePaymentRows(rows).map(row => [row.id, row.agreementName, row.recipientName,
    `${Math.floor(row.amountCents / 100)}.${String(row.amountCents % 100).padStart(2, '0')}`, row.currency, paymentStatusLabels[row.status], row.createdAt ?? '', row.providerReference ?? '']);
  return [['Payout ID','Agreement','Person','Amount','Currency','Status','Created','Provider reference'], ...records]
    .map(record => record.map(csvCell).join(',')).join('\r\n');
}
