import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { defaultPreferences, requireApprovalEmail } from '../src/preferences.js';

const password = 'Preference-test-12345';
test('preferences are authenticated, strictly validated, user-isolated and durable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fairshare-preferences-'));
  let app = await buildApp({ dbPath: join(directory, 'db') });
  try {
    const a = app.store.register({ name: 'A', email: 'a@example.test', password });
    const b = app.store.register({ name: 'B', email: 'b@example.test', password });
    const headers = { authorization: `Bearer ${a.token}` };
    assert.equal((await app.inject({ url: '/api/auth/preferences' })).statusCode, 401);
    const preferences = defaultPreferences();
    preferences.numberFormat = 'de-DE';
    preferences.dateFormat = 'iso';
    preferences.notifications.approvalRequests.email = false;
    const save = () => app.inject({ method: 'PUT', url: '/api/auth/preferences', headers, payload: preferences });
    assert.equal((await save()).statusCode, 200);
    assert.throws(() => requireApprovalEmail(app.store, a.user.id), /turned off/);
    assert.doesNotThrow(() => requireApprovalEmail(app.store, b.user.id));
    for (const extra of [{ defaultCurrency: 'EUR' }, { numberFormat: 'invalid' }, { userId: b.user.id }, { notifications: { approvalRequests: { email: 'false', inApp: true } } }]) {
      assert.equal((await app.inject({ method: 'PUT', url: '/api/auth/preferences', headers, payload: { ...preferences, ...extra } })).statusCode, 400);
    }
    assert.deepEqual((await app.inject({ url: '/api/auth/preferences', headers: { authorization: `Bearer ${b.token}` } })).json().preferences, defaultPreferences());
    await app.close();
    app = await buildApp({ dbPath: join(directory, 'db') });
    assert.deepEqual((await app.inject({ url: '/api/auth/preferences', headers })).json().preferences, preferences);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('in-app notifications respect channels, workspace and agreement membership, and provider success only', async () => {
  const app = await buildApp({ dbPath: ':memory:' });
  try {
    const a = app.store.register({ name: 'A', email: 'a@example.test', password });
    const b = app.store.register({ name: 'B', email: 'b@example.test', password });
    const w = app.store.createWorkspace(a.user.id, 'My workspace');
    const headers = { authorization: `Bearer ${a.token}` };
    const agreement = { id: 'agreement-a', name: 'Song', members: [{ userId: a.user.id }], versions: [{ id: 1, status: 'AWAITING_APPROVAL' }], audit: [{ sequence: 1, type: 'SENT_FOR_REVIEW', at: '2026-11-10T12:00:00Z', details: { versionId: 1 } }] };
    app.store.db.prepare('INSERT INTO fairshare_collaborations VALUES(?,?,?,?)').run(w.id, agreement.id, 1, JSON.stringify(agreement));
    app.store.db.prepare('INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_id,amount,status) VALUES(?,?,?,?,?,?,?,?)').run('payout-a', w.id, agreement.id, 'capture-a', a.user.id, 'recipient', 100, 'PENDING');
    let events = (await app.inject({ url: '/api/auth/notifications', headers })).json().events;
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'approvalRequests');
    assert.equal((await app.inject({ url: '/api/auth/notifications', headers: { authorization: `Bearer ${b.token}` } })).json().events.length, 0);
    app.store.db.prepare("UPDATE fairshare_payout_ops SET status='SUCCESS'").run();
    events = (await app.inject({ url: '/api/auth/notifications', headers })).json().events;
    assert.equal(events.length, 2);
    const preferences = defaultPreferences();
    preferences.notifications.approvalRequests.inApp = false;
    preferences.notifications.payoutCompleted.inApp = false;
    await app.inject({ method: 'PUT', url: '/api/auth/preferences', headers, payload: preferences });
    assert.equal((await app.inject({ url: '/api/auth/notifications', headers })).json().events.length, 0);
    app.store.db.prepare('DELETE FROM memberships WHERE user_id=?').run(a.user.id);
    assert.equal((await app.inject({ url: '/api/auth/notifications', headers })).json().events.length, 0);
  } finally { await app.close(); }
});
