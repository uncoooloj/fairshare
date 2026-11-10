import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryRequest, refundBlocked, refundMessage } from '../lib/payment-recovery';
const payment = { id: 'p1', status: 'ALLOCATED', provider_capture_id: 'cap1' };
test('recovery only constructs evidence-link endpoints and exact provider keys', () => {
  assert.deepEqual(recoveryRequest('payment', 'p1', ' ORDER1 '), { path: 'payments/p1/recover', body: { providerOrderId: 'ORDER1' } });
  assert.deepEqual(recoveryRequest('payout', 'p2', 'BATCH1'), { path: 'payouts/p2/recover', body: { providerBatchId: 'BATCH1' } });
  assert.deepEqual(recoveryRequest('refund', 'r1', 'REF1'), { path: 'refunds/r1/recover', body: { providerRefundId: 'REF1' } });
  for (const input of ['', 'https://paypal.com/x', 'bad reference', 'x'.repeat(109)]) assert.throws(() => recoveryRequest('payment', 'p', input));
});
test('refund offer blocks unverified capture, existing refund, any reserved payout and hold', () => {
  assert.equal(refundBlocked(payment, [], [], false), null);
  assert.match(refundBlocked({ ...payment, status: 'OUTCOME_UNKNOWN' }, [], [], false)!, /verified/);
  assert.match(refundBlocked({ ...payment, provider_capture_id: null }, [], [], false)!, /verified/);
  assert.match(refundBlocked(payment, [], [{ payment_id: 'p1', status: 'OUTCOME_UNKNOWN' }], false)!, /already recorded/);
  for (const status of ['RESERVED', 'FAILED', 'SUCCESS', 'OUTCOME_UNKNOWN']) assert.match(refundBlocked(payment, [{ capture_id: 'cap1', status }], [], false)!, /reserved/);
  assert.match(refundBlocked(payment, [], [], true)!, /hold/);
  assert.equal(refundBlocked(payment, [{ capture_id: 'other' }], [], false), null);
});
test('refund wording never confuses request acceptance with verified completion', () => {
  assert.match(refundMessage('COMPLETED'), /verified.*completed.*hold/);
  assert.match(refundMessage('OUTCOME_UNKNOWN'), /Do not retry/);
  for (const status of ['SUBMITTING', 'PENDING', 'FAILED', 'CANCELLED']) assert.match(refundMessage(status), /not confirmed complete/);
});
