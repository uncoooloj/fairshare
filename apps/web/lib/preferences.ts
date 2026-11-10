export const notificationLabels = {
  approvalRequests: ['Approval requests', 'When someone asks you to approve a version.'],
  versionChanges: ['Version changes', 'When a new version of an agreement is sent.'],
  payoutCompleted: ['Payout completed', 'When PayPal confirms your payout succeeded.'],
  payoutFailed: ['Payout failed', 'When a payout fails or is returned.'],
  exceptions: ['Exceptions', 'When a payment is put on hold.'],
} as const;
export type NotificationKind = keyof typeof notificationLabels;
export interface Preferences {
  defaultCurrency: 'USD';
  numberFormat: 'en-US' | 'de-DE' | 'fr-FR';
  dateFormat: 'medium' | 'day-first' | 'iso';
  notifications: Record<NotificationKind, { email: boolean; inApp: boolean }>;
}
type Display = Pick<Preferences, 'numberFormat' | 'dateFormat'>;
const defaults: Display = { numberFormat: 'en-US', dateFormat: 'medium' };
// Browser-only session state, reset whenever the signed-in user changes. Never persist credentials.
let display: Display = defaults;
export function setDisplayPreferences(value?: Display) { display = value ?? defaults; }
export function formatMoney(cents: number, preferences: Display = display) {
  return new Intl.NumberFormat(preferences.numberFormat, { style: 'currency', currency: 'USD' }).format(cents / 100);
}
export function formatDate(value: string | number, preferences: Display = display) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown date';
  if (preferences.dateFormat === 'iso') return date.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat(preferences.dateFormat === 'day-first' ? 'en-GB' : 'en-US', {
    year: 'numeric', month: preferences.dateFormat === 'medium' ? 'short' : '2-digit', day: '2-digit', timeZone: 'UTC',
  }).format(date);
}
