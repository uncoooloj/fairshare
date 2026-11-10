# Fairshare payments (sandbox only)

Uses a sandbox-only PayPal provider adapter. Hardcoded PayPal sandbox origin; no live mode. Server only; never bundle into the browser. USD integer cents only. Payouts disabled unless enabled **and** eligibility explicitly confirmed. Successful batch creation means pending, not paid. Verify exact recipient, sender IDs, amount, currency and item status on reconciliation.

## Integration contract

- Persist an immutable operation with amount, currency, reference, provider IDs and stable idempotency key **before** any provider write. All retries use the same key and parameters. Do not automatically replay a write after timeout/5xx: outcome unknown means reconcile first.
- Configure merchant ID to validate capture ownership. Keep credentials server-side, outside git, redact all request/response logging.
- `verifyAndPlanWebhook` verifies PayPal signature and produces a reconciliation or hold action. `enqueueVerifiedWebhook` is a pure reducer: API must persist returned inbox + domain changes atomically, with unique event ID/capture constraints. JSON state alone is NOT concurrency protection.
- A signed capture-completed event is not sufficient to allocate. Read order using `reconcileCapture`, match the original payment intent and then allocate once by globally unique capture ID. Fee policy must use actual verified capture fee information; do not silently assume zero fees.
- Reconciliation failures leave inbox work pending. Unknown/unmatched IDs require investigation; never silently credit them or acknowledge completion of business processing.
- Adverse capture events and dispute events, including resolution, conservatively hold outgoing funds. Match to the capture/order and immutable refund reservation; never guess automatic release, clawback or duplicate refund.
- One provider payout per persisted recipient operation simplifies item reconciliation. Duplicate event delivery must never trigger a new payout. Do not reapprove agreed shares; payout dispatch is policy-driven but subject to funds, recipient and provider checks.
- Existing sandbox merchant/recipient balances and capabilities are independent of captured checkout money. Capture followed by payout is not escrow, delayed disbursement or a verified production marketplace settlement model.

## Verification boundary

Package tests use mocked provider responses. Historical sandbox OAuth evidence from a separate implementation does not establish Fairshare capture, refund, webhook delivery, or payout behavior. Public callback-only tunnel awaits user approval. Real payment lifecycle must be demonstrated with a sandbox buyer and verified recipient item outcomes before marking ready.

## API

`PayPalSandbox` exposes credential check, order/create/capture/read, refund/read, payout/read and webhook signature verification. `verifyAndPlanWebhook`, `enqueueVerifiedWebhook`, `reconcileCapture` provide conservative processing helpers. The application owns durable operation reservations, authorization, transaction boundaries and scheduling.

## Sandbox acceptance sequence

1. Use a dedicated sandbox business app and personal sandbox buyer. Verify token authentication without logging token, secret or payer details.
2. Enable Payouts in the sandbox app before minting a fresh token; previous tokens may retain old scopes. A successful OAuth response does not prove Payouts capability.
3. After explicit public callback approval, register the restricted HTTPS webhook and keep its ID server-side. Do not expose general auth/data API routes for callback testing.
4. Create a small sandbox order with persisted intent and return/cancel origin. Buyer approves in PayPal sandbox. Read/capture once, using the existing immutable operation ID.
5. Read order, match merchant/reference/amount/currency and provider capture ID, check fee breakdown. Verify duplicate webhook delivery creates one allocation only.
6. For payout capability use a controlled sandbox recipient; validate batch acceptance then read exact item status. Report SUCCESS, UNCLAIMED or FAILED honestly; do not conflate batch accepted with recipient paid.
7. Verify a separate original-payer refund and reversal/hold behavior. This is not an automatic clawback of previously paid recipients.
8. Record redacted provider IDs, test amounts and results in acceptance evidence. Keep credentials and personal buyer/recipient identities out of repository/video. Close temporary tunnel after testing.

Live launch additionally needs confirmed eligibility, fund-flow/commercial policy and country support. Sandbox success does not grant live approval.
