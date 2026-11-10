import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatMoney, setDisplayPreferences } from '../lib/preferences';

test('display preferences change separators and dates without changing USD value', () => {
  assert.equal(formatMoney(123456), '$1,234.56');
  setDisplayPreferences({ numberFormat: 'de-DE', dateFormat: 'iso' });
  assert.match(formatMoney(123456), /1\.234,56/);
  assert.match(formatMoney(123456), /\$/);
  assert.equal(formatDate('2026-11-10T23:59:59Z'), '2026-11-10');
  assert.equal(formatDate('not-a-date'), 'Unknown date');
  setDisplayPreferences();
  assert.equal(formatMoney(123456), '$1,234.56');
  assert.equal(formatDate('2026-11-10T12:00:00Z'), 'Nov 10, 2026');
  assert.equal(formatDate('2026-11-10', { numberFormat: 'en-US', dateFormat: 'day-first' }), '10/11/2026');
});
