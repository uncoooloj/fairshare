import type { FairshareApp } from './app.js';
import type { IdentityStore } from './identity.js';
import { ApiError } from './identity.js';
import type { Collaboration } from '@fairshare/domain';

export const notificationKinds = ['approvalRequests', 'versionChanges', 'payoutCompleted', 'payoutFailed', 'exceptions'] as const;
type NotificationKind = typeof notificationKinds[number];
export interface Preferences {
  defaultCurrency: 'USD';
  numberFormat: 'en-US' | 'de-DE' | 'fr-FR';
  dateFormat: 'medium' | 'day-first' | 'iso';
  notifications: Record<NotificationKind, { email: boolean; inApp: boolean }>;
}
export function defaultPreferences(): Preferences {
  return {
    defaultCurrency: 'USD', numberFormat: 'en-US', dateFormat: 'medium',
    notifications: Object.fromEntries(notificationKinds.map(kind => [kind, { email: true, inApp: true }])) as Preferences['notifications'],
  };
}
export function readPreferences(store: IdentityStore, userId: string): Preferences {
  const row = store.db.prepare('SELECT value FROM user_preferences WHERE user_id=?').get(userId) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : defaultPreferences();
}
export function registerPreferences(app: FairshareApp) {
  const { store } = app;
  store.db.exec('CREATE TABLE IF NOT EXISTS user_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,value TEXT NOT NULL)');
  const channels = { type: 'object', additionalProperties: false, required: ['email', 'inApp'], properties: { email: { type: 'boolean' }, inApp: { type: 'boolean' } } };
  app.get('/api/auth/preferences', async req => ({ preferences: readPreferences(store, app.requireSession(req).id) }));
  app.put('/api/auth/preferences', { schema: { body: {
    type: 'object', additionalProperties: false, required: ['defaultCurrency', 'numberFormat', 'dateFormat', 'notifications'],
    properties: {
      defaultCurrency: { type: 'string', enum: ['USD'] },
      numberFormat: { type: 'string', enum: ['en-US', 'de-DE', 'fr-FR'] },
      dateFormat: { type: 'string', enum: ['medium', 'day-first', 'iso'] },
      notifications: { type: 'object', additionalProperties: false, required: [...notificationKinds], properties: Object.fromEntries(notificationKinds.map(kind => [kind, channels])) },
    },
  } } }, async req => {
    const user = app.requireSession(req);
    store.limit(`preferences:${user.id}`, 60);
    store.db.prepare('INSERT INTO user_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value').run(user.id, JSON.stringify(req.body));
    return { preferences: readPreferences(store, user.id) };
  });
  // Read actual agreement events and provider-confirmed payout states, never synthetic delivery.
  app.get('/api/auth/notifications', async req => {
    const user = app.requireSession(req), preferences = readPreferences(store, user.id);
    const rows = store.db.prepare('SELECT c.value FROM fairshare_collaborations c JOIN memberships m ON m.workspace_id=c.workspace_id WHERE m.user_id=?').all(user.id) as { value: string }[];
    const events: { id: string; kind: NotificationKind; agreementId: string; agreementName: string; at: string | null; message: string }[] = [];
    const agreements = new Map<string, Collaboration>();
    for (const row of rows) {
      const c = JSON.parse(row.value) as Collaboration;
      if (!c.members.some(member => member.userId === user.id)) continue;
      agreements.set(c.id, c);
      for (const event of c.audit) {
        const kind: NotificationKind | undefined = event.type === 'SENT_FOR_REVIEW' ? 'approvalRequests' : event.type === 'VERSION_PROPOSED' ? 'versionChanges' : event.type === 'PAYMENT_HELD' ? 'exceptions' : undefined;
        if (!kind || !preferences.notifications[kind].inApp) continue;
        // Draft versions are private to the organizer. Notify version changes only once sent.
        const version = c.versions.find(v => v.id === event.details.versionId);
        if (kind === 'versionChanges' && (!version || version.status === 'DRAFT')) continue;
        const message = kind === 'approvalRequests' ? 'An agreement version was sent for approval.' : kind === 'versionChanges' ? 'A new agreement version is available.' : 'A payment was put on hold.';
        events.push({ id: `${c.id}:${event.sequence}`, kind, agreementId: c.id, agreementName: c.name, at: event.at, message });
      }
    }
    const payouts = store.db.prepare('SELECT id,collaboration_id,status FROM fairshare_payout_ops WHERE user_id=?').all(user.id) as { id: string; collaboration_id: string; status: string }[];
    for (const payout of payouts) {
      const agreement = agreements.get(payout.collaboration_id);
      const kind = payout.status === 'SUCCESS' ? 'payoutCompleted' : ['FAILED', 'BLOCKED', 'DENIED', 'RETURNED', 'REFUNDED'].includes(payout.status) ? 'payoutFailed' : null;
      if (!agreement || !kind || !preferences.notifications[kind].inApp) continue;
      events.push({ id: `payout:${payout.id}:${payout.status}`, kind, agreementId: agreement.id, agreementName: agreement.name, at: null, message: kind === 'payoutCompleted' ? 'PayPal confirms your sandbox payout succeeded.' : `Your sandbox payout needs attention (${payout.status.toLowerCase()}).` });
    }
    return { events: events.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, 100) };
  });
}
export function requireApprovalEmail(store: IdentityStore, userId: string) {
  if (!readPreferences(store, userId).notifications.approvalRequests.email) {
    throw new ApiError(409, 'NOTIFICATIONS_DISABLED', 'This participant has turned off approval-request emails. Share the agreement link instead.');
  }
}
