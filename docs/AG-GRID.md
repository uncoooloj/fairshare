# Payout history grid

`apps/web/src/components/PaymentGrid.tsx` is a client component using AG Grid **Community** and React, official npm packages, version 36.3.0. No Enterprise imports, licence key, trial account, or sponsor signup is required.

Features: sortable agreement/recipient/amount/status/date/reference columns, text and dollar-amount filters, quick search, resizable columns, 20/50/100-row pagination, agreement drill-through callback, and distinct loading/error/empty states. The grid is read-only: allocation, authorization and money movement remain on the server. No financial CSV export is enabled.

Map authenticated API payout records to `PaymentGridRow`. `amountCents` must be integer server-ledger cents, not dollars. `currency` currently supports USD only. Map provider status explicitly: unknown outcomes must remain `UNKNOWN` (Needs reconciliation), not Paid. Dates are optional because older payout rows have none; missing dates show Not recorded rather than invented timestamps. Names use React/text rendering, never injected HTML. A malformed or duplicate-ID dataset fails closed to a generic error rather than showing misleading money data.

`onOpenAgreement(id)` lets the parent route to the approved agreement/source. Amounts sort numerically; the number filter uses displayed dollar units. This component can also be embedded in an individual agreement's payment history using a scoped rows list. Do not use it to expose other workspace data.

Verification: model tests cover exact-cent formatting, invalid/unsafe amounts, duplicate IDs, invalid dates/currencies/statuses, empty data and hold preservation. TypeScript and Next build verify compatibility. Interactive browser/keyboard review remains part of the integrated web acceptance run.

**Sponsor honesty:** This is a genuine AG Grid Community feature, not AG Studio. An AG Studio prize requires a separate meaningful integration and current eligibility verification. Installing AG Grid alone must not be described as satisfying AG Studio sponsorship requirements.
