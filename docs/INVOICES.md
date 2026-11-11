# Agreement invoices

An organizer can create an invoice only against an active, unheld agreement.
The details/review flow reserves a durable request key, creates a PayPal sandbox
invoice, publishes a payable link with both email flags disabled, and lets the
organizer copy that link. No email is sent by Fairshare.

Listing, status refresh and recovery are agreement-scoped. Unknown create outcomes
are not retried as new invoices. A provider ID can be linked by read-only recovery
only when its reference, amount and currency match the reserved invoice.

`PAID` on an invoice is not settlement proof. Buyer-paid invoices remain
`PAYMENT_PENDING` and do not allocate revenue because PayPal's invoice transaction
and capture fields have no documented correlation to the Invoicing `INV2` resource.
Manual/external payments also never allocate. Approved shares cannot be changed
through the invoice UI.

## Verification boundary

Automated tests cover the real adapter against mocked HTTP through API creation,
publish and paid-status reconciliation, including repeat requests.
Separate sandbox provider testing confirmed draft creation, publication without
email, and an unpaid payment link. A buyer-paid invoice's transaction ID to capture
and fee semantics are **not yet provider-verified**. An unsupported transaction
stays pending/fails closed rather than fabricating settled revenue.

A recovered draft has no publish-retry UI yet. Automatic payout dispatch is a
separate milestone; this change does not enable automatic money movement.
