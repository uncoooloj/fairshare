# Fairshare API flows

Status: application integration, sandbox only. Actual provider payments require configuration and live sandbox acceptance. API responses never establish legal signature/enforcement.

## Identity and context

1. `POST /api/auth/register` `{name,email,password}` → user + bearer token.
2. `POST /api/workspaces` `{name}` → workspace. Use bearer token for all subsequent calls.
3. `POST /api/workspaces/:id/invitations` `{email,role:"MEMBER"}` → one-use email-bound invite token, **manual share only**, no email sent.
4. Recipient signs up/signs in and `POST /api/invitations/accept` `{token}`.
5. Organizer creates collaboration `POST /api/workspaces/:workspaceId/collaborations` `{name}`.
6. Add accepted workspace participant `POST .../collaborations/:collaborationId/members` `{userId,expectedRevision}`. Display name comes from verified user profile, never caller-supplied impersonation. Add members before rules are drafted.

Every collaboration response is `{workspaceId,id,revision,value}`. Use latest `revision` as `expectedRevision` on every mutation. Stale changes return 409; reload and review, don't silently overwrite.

## Agreement setup

- `POST .../:collaborationId/documents` `{text}` accepts up to40,000 characters; Text-based PDF input is also supported through `POST .../:collaborationId/documents/pdf`; see PDF-INGESTION.md for limits and provenance.
- `GET .../:collaborationId/documents/:documentId` returns immutable source + any extraction result.
- `POST .../:collaborationId/documents/:documentId/extract` `{consentToCloudflare:true}` runs configured extraction and returns observations requiring human review. Missing provider configuration returns honest manual-required state. No version is activated or even created by AI.
- Human review resolves names to participant IDs, exact cents/percentages, fee policy, advance recipient and whether the prior advance was verified. `POST .../:collaborationId/versions` `{expectedRevision,rules}` creates new draft. Source quotes must occur in stored document; human proposals must be explicitly labeled as such. Quote existence is not proof of semantic correctness.
- `POST .../:collaborationId/versions/:versionId/preview` `{grossCents,feeCents}` returns preview only, no money movement. The complete allocation includes recoupment AND residual shares.
- `POST .../:collaborationId/versions/:versionId/send` `{expectedRevision}` starts review only after all ambiguities are resolved and prior advance verified.
- Each collaborator calls `.../approve` with own token; all must approve exact version. No one can approve for someone else.
- `.../request-change` `{expectedRevision,reason}` returns proposal to draft and clears prior approvals. New terms must be proposed as a new immutable version.
- Organizer calls `.../activate` after unanimity. Existing active rules remain effective until a replacement version becomes active. Past allocations never change retroactively.

## Security and persistence

Tenant and collaboration membership are checked on reads and writes. Workspace viewers cannot mutate. Access changes/removal are blocked while someone is a collaboration participant. Membership changes after drafting rules are intentionally not supported in MVP. Application owns recovery/reconciliation for those cases rather than rewriting liabilities.

Immutable documents remain server-side. API does not fetch source URLs. Text-based PDF ingestion uses a bounded local parser; see PDF-INGESTION.md. Extraction requires explicit Cloudflare processing consent and is rate limited. Do not put personal/legal documents into public demo accounts.

SQLite uses serialized transactions, revision guards and a separate capture uniqueness table for payment integration. Do not invoke allocation directly from browser-reported amounts/statuses. Only verified provider data with actual fee accounting may be allocated.

## Provider runtime configuration

Server only constructs the sandbox payment provider when PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET **and PAYPAL_MERCHANT_ID** are present, and DEMO_MODE is not true. PUBLIC_API_URL must be approved HTTPS callback origin. PAYPAL_WEBHOOK_ID is required for signed webhook verification. Payouts remain off until PAYPAL_PAYOUTS_ENABLED and PAYPAL_PAYOUTS_ELIGIBILITY_CONFIRMED are both true. Those flags are not evidence that eligibility has actually been verified.

Payment endpoint wiring is in `paymentRoutes.ts`; HTTP tests exercise injected provider responses, not real sandbox transactions. Actual provider acceptance remains a separate release gate.
