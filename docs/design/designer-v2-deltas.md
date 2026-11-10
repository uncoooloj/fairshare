# Designer export v2 delta inventory

Compared decoded templates by screen title, not regenerated UUIDs. Old: 48 states. New: 53 states (47 matched titles; 6 new titles; 1 renamed/replaced).

## Added/replaced states

- G4 · People, row menu open
- B6 · Invite accepted, sign in
- G4 · Reminder sent
- G4 · Send reminder modal
- H · Overview, revenue rules collapsed
- B6 · Collaborator invite
- Previous B6 · Collaborator invite landing replaced by Collaborator invite plus Invite accepted, sign in.

## Matched screen changes

- B1 · Sign up: visible text unchanged; export styling/runtime may differ.
- B2 · Verify email: visible text unchanged; export styling/runtime may differ.
- B3 · Welcome: visible text/structure changed.
- B4 · Your details: visible text unchanged; export styling/runtime may differ.
- B5 · Start your first agreement: visible text unchanged; export styling/runtime may differ.
- B7 · Payout account prompt: visible text/structure changed.
- C · Overview, active: visible text/structure changed.
- C · Overview, brand new (no activity): visible text/structure changed.
- C · Overview, first run: visible text/structure changed.
- Calculation drawer · from Riley’s Payouts: visible text/structure changed.
- D · Agreements list: visible text/structure changed.
- D · Agreements list, empty: visible text/structure changed.
- E1 · New agreement, details: visible text unchanged; export styling/runtime may differ.
- E2 · Document, empty: visible text unchanged; export styling/runtime may differ.
- E2 · Document, unreadable: visible text unchanged; export styling/runtime may differ.
- E2 · Document, uploaded: visible text unchanged; export styling/runtime may differ.
- E3 · People: visible text unchanged; export styling/runtime may differ.
- E4 · Review: visible text unchanged; export styling/runtime may differ.
- F1 · Reading document: visible text unchanged; export styling/runtime may differ.
- F2 · Rules review: visible text/structure changed.
- F2 · Rules review, all resolved: visible text/structure changed.
- F3 · Edit rule drawer: visible text/structure changed.
- G1 · Send for approval modal: visible text/structure changed.
- G2 · Collaborator review (Riley): visible text/structure changed.
- G2 · Request changes modal: visible text/structure changed.
- G3 · Compare versions: visible text/structure changed.
- G3 · Terms tab: visible text/structure changed.
- G4 · People tab: visible text/structure changed.
- H · Agreement workspace, overview: visible text/structure changed.
- H · Agreement workspace, sample: visible text/structure changed.
- H · Allocations tab: visible text/structure changed.
- H · Document tab: visible text/structure changed.
- H · Payments tab: visible text/structure changed.
- H · Record payment modal: visible text/structure changed.
- I · Exception detail drawer: visible text/structure changed.
- I · Payouts: visible text/structure changed.
- I · Payouts, collaborator view: visible text/structure changed.
- I · Payouts, empty: visible text/structure changed.
- J · Settings, activity log: visible text/structure changed.
- J · Settings, currency & display: visible text/structure changed.
- J · Settings, notifications: visible text/structure changed.
- J · Settings, payment accounts: visible text/structure changed.
- J · Settings, profile: visible text/structure changed.
- K · Error state: visible text/structure changed.
- K · Loading state: visible text/structure changed.
- K · Notifications panel: visible text/structure changed.
- K · Permission (collaborator): visible text/structure changed.

## Implementation scope and safeguards

- Applied compact native Status selector to existing agreement search/filter, retaining all current statuses.
- Added accessible disclosure for active revenue rules only; no-active setup action and recoupment remain visible.
- First-run workspace placement and functional navigation handled separately by workspace_ux_fix.
- Export adds a command-key search hint, but no hint should ship without working command search.
- Reminder dialogs are design additions. Show a sent state only after the configured mail transport's provider accepts the request; provider acceptance is not inbox-delivery evidence.
- Export removes inline payout error reasons; existing actionable recovery/evidence must remain until equivalent detail view exists.
- Export says Download original; new PDF/DOCX uploads support a private authenticated original download, while text-only and legacy uploads retain only extracted text.
- Added read-only version timeline and side-by-side rule comparison, amended-agreement upload language, and a payout header/export action with an empty-state link to Agreements.
- Invite acceptance presentation and People row actions still require focused integration. No blanket HTML replacement.
- Some label changes remove § from sample clause references. Do not mutate authoritative contract citations to match fixture copy.
- Repeated global header changes are layout-only; keep functional app routing, identity and guards.
