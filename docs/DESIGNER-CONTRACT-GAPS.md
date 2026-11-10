# Contract/review designer integration: capability map

Audited the designer's 48-page HTML export against the current aggregate API and domain. This is an integration checklist, not a claim that every illustrated feature is implemented.

## Critical: preserve these working invariants

- Clarification belongs inside agreement setup. Unresolved questions and unverified advances prevent sending rules for approval. A preview can still illustrate the proposed allocation, but must clearly say it is a preview requiring clarification.
- Every participant must approve the exact proposed version. Request changes returns that version to draft and clears all approvals. A new proposal starts with zero approvals.
- Previous active rules remain active while a revision is being reviewed. **Final approval does not automatically activate** the revision: the organizer must explicitly activate it. Show “All approved · Ready to activate” and an organizer-only action, not “Activated” on approval.
- Source uploads are immutable records. Uploading a replacement source does not itself create a new version or revoke/change existing rules. The UI must explicitly propose a new version after reading/reviewing it.
- All agreement writes carry the latest aggregate revision. On a 409, reload and explain that another person changed the agreement; do not silently replay an approval against changed terms.
- Payments and payouts are different from approvals. Allocated/held/provider-confirmed values come from backend records, not designer sample rows.

## Screens: wire now vs correct or defer

| Designer screen                                                                 | Existing backend                                                                         | Integration decision                                                                                                          |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Upload (`148ab712…`) promises PDF/DOCX, 25MB, scanned documents                 | Text upload or text-layer PDF only; 5 MiB, 20 pages, 40,000 extracted characters; no OCR | Correct upload copy and accepted file types; retain paste-text fallback and actionable unreadable-PDF state                   |
| Document (`7d416b4d…`) original download/PDF viewer                             | Extracted text, page offsets and original file hash; original binary not retained        | Render extracted text and provenance. Do not show a fake original download or PDF page viewer                                 |
| Setup (`4b06907e…`, `94e49852…`) currency and effective dates                   | Name at creation; USD in rules; no effective-date enforcement                            | Lock USD. Do not imply effective dates control allocations unless implemented                                                 |
| Review (`8ada7852…`, `1eaa78c0…`) approve/request changes and per-rule comments | Version approval and version-level request-change reason                                 | Wire existing actions. Include rule label in the reason text if useful, but do not imply threaded rule comments exist         |
| Terms (`5be7700e…`) active/pending versions and comparison                      | Immutable versions with statuses, approvals and change requests                          | Display actual version history and compare stored rules. Keep comment-thread and automatic-activation promises out            |
| People (`3bf16868…`) reminders and payout connected                             | Workspace membership/agreement members; no reminder delivery                             | Do not expose a successful “Reminder sent” without actual delivery. Destination email is not verified PayPal OAuth connection |
| Invitation (`95040067…`) Google/Microsoft login                                 | Email/password and workspace invite acceptance                                           | Only show supported authentication methods                                                                                    |

## Rule semantics not implemented by generic contract prose

Executable rules currently support USD, participant shares, fee policy (fees before split or organizer bears fees), and one verified advance. They do **not** execute arbitrary operating costs, effective-date ranges, tax terms, distribution deadlines, or automatic future-payment refund offsets.

The designer review example defines net revenue as “everything received before any costs” while its source says “less applicable costs.” This must surface as clarification, not a confidently extracted agreement. Do not map arbitrary contractual “costs” to PayPal processing fees without explicit agreement.

The source's example refund clause (“deduct from future Net Revenue”) is not the existing recovery behavior: the backend conservatively holds affected allocations for reconciliation. Preserve that safety behavior and explain the hold. Never label it as an automatic clawback.

Agreement participants must be accepted workspace members **before the first version is proposed**. The current membership route rejects adding participants once any version exists. Setup must gather participants before rule creation; an unrestricted “Add collaborator” action on an active agreement would be misleading.

## Regression coverage

`apps/api/test/designerContractFlow.test.ts` adds three real API regressions:

1. Unresolved send/approval rejection and side-effect-free preview.
2. Active-version preservation, change-request approval reset, fresh unanimity, explicit organizer activation.
3. Replacement-source immutability and fresh approvals on the subsequent proposal.

These tests do not verify visual parity, provider capture, browser interaction, email delivery, or a live AI extraction.
