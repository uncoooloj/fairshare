# Sandbox payment flow and verification boundary

The API registers sandbox routes under each authenticated collaboration. Only its organizer can create checkout, capture/reconcile payment, dispatch fixed allocations or reconcile payout status. Collaborators can read the collaboration's payment and payout ledger and set only their own sandbox PayPal recipient ID. No endpoint accepts arbitrary allocation amounts for payouts.

1. POST `.../payments` with `{requestKey, amountCents}` reserves an immutable operation under active unanimously approved rules. A repeat key with different amount or collaboration is rejected. Return includes sandbox approval URL after provider order creation.
2. Buyer approves in PayPal sandbox; return/cancel callbacks make no claims about payment completion.
3. POST `.../payments/:paymentId/capture`, then reconcile. Provider read must match order/reference/capture/currency/gross and fee accounting before atomic allocation. Changed active rule version blocks allocation for explicit reconciliation instead of silently applying new terms.
4. POST `/api/paypal/webhook` verifies PayPal signature, persists event fingerprint and action, rejects changed payloads under existing ID, and processes capture/hold/payout reconciliation. Failures remain PENDING and return503 so provider retries. Unknown IDs retained, never silently credited.
5. PUT `.../recipient` with `{paypalId}` stores current user's recipient destination. POST `.../payouts/dispatch` with `{captureId}` reserves each exact allocation once and submits it to sandbox. It is a dispatch command, not discretionary approval of shares. Dispatch remains explicit; the opt-in reconciliation worker only reads and reconciles known operations.
6. Repeated dispatch never sends a second payment for existing operation. POST `.../payouts/:payoutId/reconcile` verifies provider item and updates status. Acceptance is PENDING, not paid. Frozen recipient/amount remain unchanged if profile changes.

## Deliberate fail-closed limits

- Unknown order creation/payout write outcomes need operator investigation; the API will not blindly reissue a write. There is not yet an operator recovery UI. An opt-in scheduled reconciliation worker can reconcile known operations but never performs money-moving retries.
- An adverse event arriving before capture allocation blocks allocation; one arriving afterward preserves liabilities and puts collaboration on hold. No guessed automatic release or clawback.
- Refund API remains available only in the provider package, not a user-facing arbitrary refund route. Rule-aware refund handling and already-paid liability policy require further implementation.
- Missing recipient, payment hold, missing provider fee data and changed rules block progression. Payout eligibility flags are off by default. Payouts may require sender balance independent of the captured checkout.
- Provider credentials must stay server-side. Configure merchant ID and webhook ID. Current test success uses mocked providers; historical OAuth-only sandbox evidence does not establish Fairshare checkout or payout verification.
- No production/live money mode. No escrow or guaranteed live marketplace splitting claim.

Tests cover immutable checkout retry keys, access isolation, duplicate verified events, mismatched event IDs, fee requirements, duplicate payout dispatch, provider-verified item statuses, unknown outcomes and reversal before/after capture.

## Source labels

Checkout accepts optional `source: {type: "OTHER", name: "Bandcamp"}` or `{type: "PAYPAL"}`. Other requires 1–100 non-control characters. Omission defaults to PayPal, including existing records. Source attribution is immutable under the checkout request key; changing it on a retry returns `IDEMPOTENCY_CONFLICT` instead of creating another payment.

`source_type` and `source_name` are organizer-entered labels returned with payment records. They are never provider evidence, do not import external revenue and cannot mark money confirmed. All actual checkout/capture verification still uses PayPal sandbox. The UI retains the original uncertain-request key when a label changes.
