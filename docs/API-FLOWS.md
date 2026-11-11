# Fairshare API flows

Status: application integration, sandbox only. Actual provider payments require configuration and live sandbox acceptance. API responses never establish legal signature/enforcement.

## Identity and context

1. `POST /api/auth/register` `{name,email,password}` → user + bearer token.
2. `POST /api/workspaces` `{name}` → workspace. Use bearer token for all subsequent calls.
3. The primary invitation flow is `POST /api/workspaces/:id/invitation-links` `{role:"MEMBER"}`. It creates one private, single-use link; share it directly with the intended collaborator. No email is sent.
4. Recipient signs up/signs in and `POST /api/invitations/accept` `{token}`. The optional legacy `POST /api/workspaces/:id/invitations` `{email,role:"MEMBER"}` route remains registered: DEMO returns a synthetic link even when `emailDelivery` is false, while SANDBOX requires configured mail delivery. Provider acceptance is not inbox-delivery evidence.
5. Organizer creates collaboration `POST /api/workspaces/:workspaceId/collaborations` `{name}`.
6. Add each accepted workspace participant to the agreement with `POST .../collaborations/:collaborationId/members` `{userId,expectedRevision}`. Display name comes from verified user profile, never caller-supplied impersonation. Workspace-invitation acceptance grants workspace access only: it does not create agreement membership or review/approval eligibility. The organizer adds the accepted person to the agreement before the first draft.

Every collaboration response is `{workspaceId,id,revision,value}`. Use latest `revision` as `expectedRevision` on every mutation. Stale changes return 409; reload and review, don't silently overwrite.

## Agreement setup

- `POST /api/agreements/intake` creates the workspace (when `workspaceId` is omitted), organizer membership, agreement and immutable source in one transaction. Send a UUID `requestId` and exactly one source: `{requestId,text}` for 1–40,000 characters, or `{requestId,base64,mimeType,filename?,useLocalOcr?}` for PDF/DOCX. A text upload is accepted as text. PDF/DOCX parsing finishes before any durable write, so an unreadable or invalid source creates nothing.
- Reuse the same `requestId` only to retry the unchanged intake: it returns the original workspace, agreement and document. Reusing it with changed input returns `409 IDEMPOTENCY_CONFLICT`; use a new UUID. Keys are scoped to the signed-in user. An optional `workspaceId` must be a workspace where that user is an owner or member; viewers cannot create the agreement there.
- A new agreement and automatically created workspace start with a sanitized filename title. Without a filename, intake may use only the first nonempty pasted line when it is a short, safe heading that looks like an agreement, contract or memorandum; clauses, commands and unsafe text fall back to **Untitled agreement**. This local fallback does not use an AI provider. The organizer can rename the agreement afterward (with its current `expectedRevision`). Internal workspace naming is not exposed in the app. Renaming never changes the source or terms.
- `POST .../:collaborationId/documents` `{text}` accepts up to 40,000 characters. Text-layer PDF input uses `POST .../:collaborationId/documents/pdf`; DOCX input uses `POST .../:collaborationId/documents/docx`. See PDF-INGESTION.md and security/source-documents.md for bounds and retention.
- `GET .../:collaborationId/documents/:documentId` returns immutable source + any extraction result. New PDF/DOCX records report whether an original attachment is available; authorized members can request `GET .../:documentId/original` for that attachment.
- `GET .../:collaborationId/documents/capabilities` reports whether the host has enabled local OCR. When enabled, a textless PDF automatically falls back once from native text extraction to local OCR; text-layer PDFs do not use OCR. Legacy clients can still explicitly request `useLocalOcr`; see LOCAL-OCR.md.
- `POST .../:collaborationId/documents/:documentId/extract` `{consentToCloudflare:true}` runs configured extraction and returns observations requiring human review. The existing request field is named `consentToCloudflare`, but the explicit UI consent discloses Cloudflare as the primary provider and configured Anthropic fallback. This boolean gates the request; it is not a persisted consent receipt. Missing provider configuration returns honest manual-required state. No version is activated or even created by AI.
- Human review resolves names to participant IDs, exact cents/percentages, fee policy, advance recipient and whether the prior advance was verified. `POST .../:collaborationId/versions` `{expectedRevision,rules}` creates new draft. Before the first draft, the web UI requires the person saving it to acknowledge that every person needing a share or approval has already been added; this is a UI acknowledgement, not a separate API membership or approval operation. Source quotes must occur in stored document; human proposals must be explicitly labeled as such. Quote existence is not proof of semantic correctness.
- `POST .../:collaborationId/versions/:versionId/preview` `{grossCents,feeCents}` returns preview only, no money movement. The complete allocation includes recoupment AND residual shares.
- The organizer normally uses `POST .../:collaborationId/submit` `{expectedRevision,rules}` to create a version, record the organizer's approval and send it for review in one transaction. It requires all ambiguities resolved; an advance may still be unverified when sent. The lower-level `POST .../versions/:versionId/send` `{expectedRevision}` starts review for an existing draft under the same rule.
- Each joined collaborator calls `.../approve` with their own token; no one can approve for someone else. Pending invited people cannot approve, and prevent activation until they join. The final required approval activates the exact version when its advance is already confirmed; otherwise the version stays `AWAITING_APPROVAL` with approvals recorded until the organizer confirms payment. `.../activate` remains an organizer-only compatibility endpoint and returns `409 ADVANCE_UNCONFIRMED` while that confirmation is pending.
- `.../request-change` `{expectedRevision,reason}` returns proposal to draft and clears prior approvals. New terms must be proposed as a new immutable version. The current active version remains effective while the replacement is pending.
- The organizer confirms an unpaid advance with `POST .../:collaborationId/advance/confirm` `{expectedRevision,advanceId}`. The endpoint is organizer-only and applies the confirmation and any resulting activation in the revision-CAS transaction; it records `ADVANCE_CONFIRMED`. Stale revisions return `409 REVISION_CONFLICT`, a non-current advance returns `409 STALE_VERSION`, a duplicate confirmation returns `409 ADVANCE_ALREADY_CONFIRMED`, and a non-organizer receives `403 FORBIDDEN`. `.../activate` remains available for compatibility when all approvals and advance confirmation are already complete. Past allocations never change retroactively.

## Security and persistence

Tenant and collaboration membership are checked on reads and writes. Workspace viewers cannot mutate. Access changes/removal are blocked while someone is a collaboration participant. Organizers can change agreement participants until the rules are first sent. After sending, pending invite links can be replaced without changing their assigned share; the participant list otherwise stays locked. Application owns recovery/reconciliation for those cases rather than rewriting liabilities.

Immutable documents remain server-side. New PDF/DOCX originals are private authenticated attachments; text-only and legacy documents retain extracted text only. API does not fetch source URLs. PDF and DOCX ingestion use bounded local parsers; see PDF-INGESTION.md and security/source-documents.md. Extraction requires explicit consent that discloses Cloudflare processing and the optional Anthropic fallback; it is rate limited. Do not put personal/legal documents into public demo accounts.

SQLite uses serialized transactions, revision guards and a separate capture uniqueness table for payment integration. Do not invoke allocation directly from browser-reported amounts/statuses. Only verified provider data with actual fee accounting may be allocated.

## Account settings

- Public `GET /api/auth/capabilities` returns `{invitationDelivery:"LINK",emailDelivery:boolean}`. `invitationDelivery` identifies the link-first collaboration flow; `emailDelivery` is true only when the server has a configured non-DEMO mail transport. The capability gates current web email-request controls, not the optional legacy email-invitation backend route, which has no web creation control.
- `GET` and `PUT /api/auth/preferences` read and replace the full display and notification preference object. USD remains the only supported currency; number and date formats affect display only and never convert amounts or change amount-entry syntax. Account-security email is outside these preferences.
- In-app notifications are built from accessible agreement audit events and provider-confirmed sandbox payout states. The current web settings surface offers in-app notification choices only. Legacy saved email preference data can still gate configured approval-request email on the API; it does not establish delivery.
- `GET /api/settings/activity` returns a read-only, paged activity log. It accepts optional `workspaceId`, `actorId`, `action`, `agreementId`, `days` (`0`, `7`, `30`, or `90`) and `offset`. A workspace query includes only agreements visible to the current user.
- `GET /api/workspaces/:workspaceId/payment-accounts` is the v1 compatibility response for cached clients. It exposes only each member's workspace-scoped 13-character sandbox merchant ID status and masked merchant-ID hint; it never exposes an account email. If a person has an account-level payout destination, v1 returns `MISSING` without a hint rather than reporting a merchant ID that cannot control their effective destination. A member or owner can `PUT` or `DELETE .../payment-accounts/mine` for that legacy merchant ID only when no account-level destination exists; otherwise it returns `409 PAYOUT_DESTINATION_CONFLICT`. The collaboration `PUT .../recipient` endpoint preserves the same member authorization, merchant-ID-only behavior, and conflict.
- New clients must opt in with `GET /api/workspaces/:workspaceId/payment-accounts?version=2`. Its `own` field is visible only to the caller and may be an account-level PayPal email; every `members[]` entry exposes readiness (`READY` or `NEEDS_EMAIL`) only. `GET`, `PUT`, and `DELETE /api/auth/payout-account` manage the caller's account-level payout email. Email destinations are never returned for peers and do not change already-submitted payouts.

## Provider runtime configuration

Server only constructs the sandbox payment provider when PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET **and PAYPAL_MERCHANT_ID** are present, and DEMO_MODE is not true. PUBLIC_API_URL must be approved HTTPS callback origin. PAYPAL_WEBHOOK_ID is required for signed webhook verification. Payouts remain off until PAYPAL_PAYOUTS_ENABLED and PAYPAL_PAYOUTS_ELIGIBILITY_CONFIRMED are both true. Those flags are not evidence that eligibility has actually been verified.

Payment endpoint wiring is in `paymentRoutes.ts`; HTTP tests exercise injected provider responses, not real sandbox transactions. Actual provider acceptance remains a separate release gate.

### Private invitation links (no email dependency)

Workspace owners create a single-use member/viewer link using
`POST /api/workspaces/:id/invitation-links` with `{ "role": "MEMBER" }`.
Settings → Other invitations exposes
**Create private invitation link**, **Copy link**, and **Revoke link**.
This is the primary invitation flow. Send the link privately to one intended collaborator. The link expires in 48 hours.
The recipient signs in (or creates an account), then explicitly accepts it.

This is bearer-link authorization, not proof of mailbox ownership: anyone holding
it can redeem it once as their authenticated account. It grants only the selected
workspace role, never OWNER, and does not approve agreements or move money.
Raw tokens are returned only at creation to the authorized owner, held in page
memory, and placed in the URL fragment, not a query string. The database stores a
hash; audit events omit secrets. Refreshing loses the displayed link. Existing
email invitations retain their independently verified-email requirement in
SANDBOX; private links require no mail provider in either environment.

An agreement's People section has a separate draft-only link flow. A workspace
OWNER who is also that agreement's ORGANIZER creates it with
`POST /api/workspaces/:workspaceId/collaborations/:agreementId/invitation-links`.
The recipient accepts it through `POST /api/agreement-invitations/accept` and
becomes a workspace MEMBER plus an agreement COLLABORATOR. It never approves
rules or moves money, cannot be used after the first proposal exists, and does
not change the workspace-only link behavior above.

## Invitation landing

An authenticated invitation recipient sees the acceptance prompt before workspace creation forms. **Not now** dismisses the local prompt without accepting the link. After acceptance, a member with no shared agreements sees guidance to ask the organizer for agreement access and refresh; the invitation does not require another document upload. Viewers receive read-only access guidance. The API supports MEMBER and VIEWER invitation-link roles; the current UI creates MEMBER links.
