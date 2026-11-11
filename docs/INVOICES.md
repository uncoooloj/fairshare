# Agreement invoices

An organizer can create an invoice only against an active, unheld agreement.
The details/review flow reserves a durable request key, creates a PayPal sandbox
invoice, publishes a payable link with both email flags disabled, and lets the
organizer copy that link. No email is sent by Fairshare.

Listing, status refresh and recovery are agreement-scoped. Unknown create outcomes
are not retried as new invoices. A provider ID can be linked by read-only recovery
only when its reference, amount and currency match the reserved invoice.

## Payment evidence and settlement

Invoice total, provider-recorded paid amount, and balance due are distinct fields.
A zero balance due is not a zero-value invoice. Missing provider balances are shown
as unverified, never defaulted to zero.

All entry points use the same reconciliation: manual status check, background
invoice discovery, and signed invoice webhooks. Provider `PAID` alone is not enough.
A single full-value PAYPAL transaction is a lookup candidate. A fresh capture read
must explicitly match the transaction ID, `invoice_id` to the INV2 resource,
configured payee merchant, USD gross, and actual fee/net accounting. Only a
COMPLETED capture with balanced gross = fee + net can allocate against the original
active rule version. Converted merchant receivable amounts are not used as USD net.

The invoice, global capture uniqueness record and domain allocation are committed
atomically. Another invoice or checkout cannot claim an already-used capture.
Duplicates do not allocate twice. Missing fees, mismatched references, unsupported
partial/multiple payments and external/manual markings never fabricate revenue.
A provider-paid invoice without sufficient settlement evidence remains visibly
recorded but unverified; paid webhook processing stays retryable.

Refunds, cancellations, disputes and capture reversals hold allocations without
rewriting history or inventing a clawback. Invoice adverse evidence is sticky even
before allocation. Later paid events cannot silently release a hold. Invoice
refunds must currently be handled in PayPal; the checkout refund UI does not accept
invoice receipts.

## Verification boundary

Tests cover real-adapter HTTP fixtures, paid-status/capture reconciliation, actual
fees, wrong identity/merchant/currency, duplicate deliveries, pre-allocation adverse
events, stale concurrent reads, changed rules, and UI balance distinctions.
A read-only sandbox investigation verified that an existing invoice transaction
resolved to a capture with the exact INV2 invoice identity, expected merchant and
balanced USD fee/net data. This is not a guarantee that every invoice transaction
supports that correlation; unsupported cases remain pending.

No new payments, payouts or refunds were executed to validate this change.
See [webhook events and retries](PAYPAL-WEBHOOKS.md) for subscriptions and replay.
