"use client";
import { useEffect, useState } from 'react';
import { api } from '../lib/model';
import { formatDate, formatMoney, notificationLabels, setDisplayPreferences, type Preferences, type NotificationKind } from '../lib/preferences';

export function useDisplayPreferences(userId?: string) {
  const [, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    setDisplayPreferences();
    if (userId) api<{ preferences: Preferences }>('auth/preferences').then(({ preferences }) => {
      if (active) { setDisplayPreferences(preferences); refresh(value => value + 1); }
    }).catch(() => { /* Keep default display if settings cannot be loaded. */ });
    const update = () => refresh(value => value + 1);
    window.addEventListener('fairshare-preferences', update);
    return () => { active = false; setDisplayPreferences(); window.removeEventListener('fairshare-preferences', update); };
  }, [userId]);
}

function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    api<{ preferences: Preferences }>('auth/preferences').then(result => { if (active) setPreferences(result.preferences); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  async function save() {
    if (!preferences || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await api<{ preferences: Preferences }>('auth/preferences', 'PUT', preferences);
      setPreferences(result.preferences); setDisplayPreferences(result.preferences);
      window.dispatchEvent(new Event('fairshare-preferences'));
      setNotice('Preferences saved.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save preferences.'); }
    finally { setSaving(false); }
  }
  return { preferences, setPreferences, error, notice, saving, save };
}
function Feedback({ error, notice }: { error: string; notice: string }) {
  return <>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</>;
}
export function NotificationsSettings() {
  const state = usePreferences();
  const { preferences, setPreferences, saving } = state;
  const [events, setEvents] = useState<{ id: string; message: string; agreementName: string; at: string | null }[]>([]);
  const [feedError, setFeedError] = useState('');
  useEffect(() => {
    let active = true;
    api<{ events: typeof events }>('auth/notifications').then(result => { if (active) { setEvents(result.events); setFeedError(''); } }).catch(() => { if (active) setFeedError('Could not load recent notifications.'); });
    return () => { active = false; };
  }, [state.notice]);
  return <section className="panel">
    <h2>Notifications</h2><p className="muted">Choose how Fairshare tells you about things.</p>
    <Feedback error={state.error} notice={state.notice} />
    {!preferences ? <p>Loading preferences…</p> : <form onSubmit={event => { event.preventDefault(); void state.save(); }}>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%' }}><thead><tr><th scope="col">Notification</th><th scope="col">In-app</th></tr></thead><tbody>
        {(Object.keys(notificationLabels) as NotificationKind[]).map(kind => <tr key={kind}>
          <th scope="row" style={{ textAlign: 'left', padding: '16px 0', fontWeight: 500 }}>{notificationLabels[kind][0]}<p className="muted" style={{ fontWeight: 400 }}>{notificationLabels[kind][1]}</p></th>
          {(['inApp'] as const).map(channel => <td key={channel} style={{ textAlign: 'center' }}><input type="checkbox" aria-label={notificationLabels[kind][0] + ' in-app'} disabled={saving} checked={preferences.notifications[kind][channel]} onChange={event => setPreferences({ ...preferences, notifications: { ...preferences.notifications, [kind]: { ...preferences.notifications[kind], [channel]: event.target.checked } } })} /></td>)}
        </tr>)}
      </tbody></table></div>
      <p className="muted">Updates appear here in Fairshare. Share invitation links and copy review reminders to notify collaborators directly; no email is sent.</p>
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save preferences'}</button>
    </form>}
    <h3 style={{ marginTop: 32 }}>Recent notifications</h3>
    {feedError ? <p role="alert">{feedError}</p> : !events.length ? <p className="muted">No matching notifications yet. Agreement reviews and confirmed payout updates will appear here.</p> : <ul>{events.map(event => <li key={event.id} style={{ padding: '10px 0' }}><strong>{event.agreementName}</strong><p>{event.message}</p>{event.at && <time dateTime={event.at}>{formatDate(event.at)}</time>}</li>)}</ul>}
  </section>;
}
export function CurrencyDisplaySettings() {
  const state = usePreferences();
  const { preferences, setPreferences, saving } = state;
  return <section className="panel">
    <h2>Currency &amp; display</h2><p className="muted">How amounts and dates look across Fairshare.</p>
    <Feedback error={state.error} notice={state.notice} />
    {!preferences ? <p>Loading preferences…</p> : <form onSubmit={event => { event.preventDefault(); void state.save(); }} style={{ display: 'grid', gap: 24, maxWidth: 560 }}>
      <label>Default currency<select value={preferences.defaultCurrency} disabled aria-describedby="currency-help"><option value="USD">USD – US dollar</option></select><p id="currency-help" className="muted">Agreements and PayPal sandbox payments currently support USD only. This setting never converts money.</p></label>
      <label>Number format<select disabled={saving} value={preferences.numberFormat} onChange={event => setPreferences({ ...preferences, numberFormat: event.target.value as Preferences['numberFormat'] })}><option value="en-US">1,234.56</option><option value="de-DE">1.234,56</option><option value="fr-FR">1 234,56</option></select><p className="muted">Preview: {formatMoney(123456, preferences)}. Amount-entry fields still use a decimal point.</p></label>
      <label>Date format<select disabled={saving} value={preferences.dateFormat} onChange={event => setPreferences({ ...preferences, dateFormat: event.target.value as Preferences['dateFormat'] })}><option value="medium">Nov 10, 2026</option><option value="day-first">10/11/2026</option><option value="iso">2026-11-10</option></select><p className="muted">Preview: {formatDate('2026-11-10T12:00:00Z', preferences)}. Dates use UTC.</p></label>
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save preferences'}</button>
    </form>}
  </section>;
}
