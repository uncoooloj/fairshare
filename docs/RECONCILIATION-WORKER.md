# Sandbox reconciliation worker

Opt in with `PAYPAL_RECONCILIATION_ENABLED=true` on the API process. It requires SANDBOX mode and a configured PayPal provider; DEMO refuses to start with this setting. Disabled by default. No live-money mode exists.

Every 30 seconds it discovers known order IDs, pending payout batch IDs, pending refund IDs and verified pending webhook inbox events. It reconciles at most 20 jobs per tick, in deterministic due-time/kind/ID order. Successful reads schedule another check after 30 seconds; failures exponentially back off to one hour. Terminal operations are removed from scheduling. Unknown writes **without** provider IDs remain evidence-only manual recovery.

Scheduling and per-operation leases persist in SQLite. A 120-second lease is heartbeated while reading the provider; an expired or replaced lease fences all callback writes. Local ticks coalesce; shutdown stops scheduling, fences pending callbacks and waits for the in-flight read before closing SQLite. Existing provider reads have bounded HTTP timeouts. Keep the existing deployment recommendation: one API instance and local persistent disk. Leases protect accidental duplicate workers, not an unsupported network-mounted SQLite deployment.

This worker does **not** create orders, capture payments, dispatch payouts, request refunds, release holds or invent missing provider evidence. It may apply an already-completed, independently verified capture to the local allocation ledger, or persist independently verified payout/refund statuses. Existing amount/reference/currency/merchant/fee/version/hold protections remain. Refund completion leaves the liability hold in place.

`fairshare_reconciliation_jobs` stores only internal operation IDs, safe outcome codes, attempts, due times and lease metadata, not provider payloads or secrets. `CHECKED` means a read succeeded, not that money was received. `RETRY_REQUIRED` means reconciliation needs another attempt, never a blind money-write retry. Full recipient delivery and signed webhook acceptance must still be verified against actual sandbox evidence.
