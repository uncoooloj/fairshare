# Automatic sandbox payouts

Enable `PAYPAL_AUTOMATIC_PAYOUTS_ENABLED=true` only with the configured sandbox
provider, `PAYPAL_RECONCILIATION_ENABLED=true`, and PayPal Payouts eligibility.
Cloudflare runs the same queue from its Durable Object alarm.

1. A verified capture is committed to the global capture ledger with immutable,
   approved integer-cent allocations. An invoice's `PAID` label alone is insufficient.
2. Each allocation is considered separately. Participants save their own PayPal
   recipient ID. Missing/invalid IDs produce `WAITING_RECIPIENT`, not guessed recipients.
3. Holds, missing approvals, adverse webhooks and refund records are checked while
   claiming an outgoing payout. A hold that arrives after submission is retained for
   explicit resolution; Fairshare does not assume it can cancel or claw back a
   provider payout.
4. A unique `(capture_id,user_id)` reservation is committed before submission. Manual
   dispatch and concurrent workers cannot create another payout for that allocation.
5. Provider acceptance becomes `PENDING`, not success. Existing item-level provider
   reconciliation/webhooks determine the eventual result.

`AUTO_HELD`/`WAITING_RECIPIENT` can be reconsidered after the underlying issue is
resolved. `SUBMITTING` after interruption and `OUTCOME_UNKNOWN` are never blindly
retried. Recover them only with matching provider batch evidence through existing
recovery tools. Failed/returned payouts are not automatically reissued. Refunds and
reversals after sending require explicit resolution; the system does not guess a clawback.

No live payments are enabled by this feature. Real sandbox create/poll verification
is still required in the deployed environment before declaring end-to-end completion.
