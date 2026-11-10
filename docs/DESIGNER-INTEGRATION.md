# Designer export integration

Source: supplied Fairshare HTML export, 48 bundled screen references. The export is a visual reference, not executable application code. Its bundled scripts were not incorporated.

Implemented: local licensed Onest fonts, neutral/blue design tokens, desktop shell, card surfaces, sidebar, tables and responsive layout; login/registration; workspace introduction; invitation/verification prompts; agreement search and status filters; participant avatars; split and allocation tables; source-cited AI rule cards; payout summaries/filtering and exception/recovery panels.

All displayed operational values come from existing API state. The onboarding example is explicitly illustrative. Existing provider reconciliation, refund confirmation, permissions, amount validation and API callbacks are retained. Overview counters intentionally use known agreement/approval/hold data rather than fabricated monthly revenue.

Not claimed: pixel-exact reproduction of all 48 screens, new OAuth, OCR support, notification delivery, automatic activation, multi-currency rules, or new backend capabilities. Contract wizard and settings still use existing functional structures styled through tokens. Browser/interaction QA remains required; source-level tests are not a substitute.

The design's approval workflow remains governed by backend constraints: accepted members before proposal, unanimous version approval followed by organizer activation, and no routine discretionary payout-amount votes.

## Follow-up coverage and priorities

Implemented after initial handoff: guided creation/people-first setup, profile/security/invitation settings surfaces, review-readiness/clarification/approval panel, payout details and safe filtered CSV, and dedicated version-pinned Document view with extracted-text download. Source document loading clears stale state and ignores late responses.

Remaining highest-value reference gaps:

1. Distinct Allocations tab with source-linked per-capture calculation view (currently functional within Payments).
2. Compare proposal versions, showing deterministic differences and unchanged active rules.
3. Overview attention cards linking directly to pending approvals/holds instead of only counts.
4. Refine source-upload and rule-review layout into clearer staged surfaces without bypassing pre-proposal membership or explicit activation.

Do not add visual-only notification/profile editing toggles without working endpoints. Current unsupported export concepts remain excluded. Every screen still needs browser interaction and visual comparison; component/source tests do not establish pixel fidelity.
