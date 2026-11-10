# Fairshare domain

Pure, immutable aggregate transitions. No network calls, AI money arithmetic, or payout submission. Explicit enums; USD MVP; exact integer cents and basis points. All human proposals stay inactive until every participant approves the same version and the organizer activates it. Source excerpts must be verified by the extraction/application layer; this module validates their presence, not legal accuracy.

## API integration requirements

- Load and persist an entire transition in a serialized DB transaction with optimistic revision checks. A read/modify/write without transaction is unsafe.
- Authenticate actors at the server. Never accept actor IDs from arbitrary browser payloads. This module checks membership/organizer role, not identity proof.
- Only call `allocateConfirmedRevenue` after verifying PayPal payment/capture/reference/currency/amount and actual processing fee. Missing fee data must BLOCK allocation, not default to zero.
- Enforce globally unique provider capture IDs across collaborations, not only within this aggregate. Store verified webhook event IDs durably and reconcile duplicate delivery safely.
- `grossCents - feeCents` is conserved. Recoupment and residual shares are BOTH included in allocation totals. Recoupment progress carries across versions referencing the same immutable advance ID.
- Preview returns `previewOnly: true`, does not record revenue, and never sends money. Unresolved assumptions remain marked.
- ALLOCATED does not mean paid. Actual payouts, payout fees, recipient verification and provider outcomes belong to payment/application layers. No routine re-approval of calculated shares is required by this domain; payout authority and safety checks remain separate.
- A reversal holds all allocations in the affected collaboration, preserving historical amounts/recoupment. It does not undo payments or invent a clawback. Unknown captures must remain in an unmatched-event queue. Explicit operator reconciliation is still required; no automatic hold release exists.
- Data is local aggregate state, not a legal contract execution/signature system. Historical source docs must be versioned/immutable. Participant changes, FX, taxes and multiple simultaneous advances are outside this MVP.

## Supported fee policies

BEFORE_SPLIT deducts actual processing fees before recoupment/residual sharing. ORGANIZER_SHARE calculates gross entitlements then charges the designated organizer's allocation; if insufficient, fails with FEE_EXCEEDS_SHARE rather than creating negative balances.

Rounding uses largest remainders with stable user-ID tie breaking. Every approved rule must specify participant shares summing to 10,000 basis points.
