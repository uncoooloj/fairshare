# Transactional email with Resend

Fairshare supports Resend through a server-only HTTPS adapter in both the Node API and the hosted Cloudflare Durable Object. Email is disabled by default. This integration does not create a provider account, configure DNS, authorize charges, deploy, or prove inbox delivery.

## What sends email

- Account verification, password recovery for verified accounts, and email-change confirmation.
- An organizer's explicit **Email invitation** action for an existing named person's current link. Merely adding a person, sending rules for review, loading a page, or merging this code sends nothing.
- An organizer's explicit **Email review reminder** action for a joined, verified participant awaiting approval of the latest version.
- The existing workspace-invitation API, for clients that already use it. It is separate from the agreement invitation UI and requires independently verified recipient accounts.

Copy/Share links always remain available. Capability-gated controls only appear after `GET /api/auth/capabilities` reports `emailDelivery: true`; a capability means the transport is configured, not that the sender domain or delivery has passed acceptance. Approval-request email preferences are honored for existing accounts. Other notification categories remain in-app only; there is no background notification mailer.

## Provision and configure

1. Create or authorize a Resend account. Use its free plan if sufficient; do not upgrade or add paid services implicitly.
2. Verify a domain you control in the Resend dashboard. Prefer a dedicated sending subdomain to isolate reputation. Publish exactly the dashboard-provided DKIM/SPF/MX records in the authoritative DNS zone. Preserve existing website and inbox records. Do not guess DNS values or replace the root domain's MX/SPF records. Configure DMARC consistently with the existing domain policy, then wait for Resend's verification result.
3. Turn off click and open tracking for transactional messages. Authentication and invitation URLs hold single-use credentials in fragments; do not rewrite them or add analytics. Do not use Resend's onboarding sender for real invitees, because it is restricted to account-owner testing.
4. Create a **Sending access** API key restricted to the verified sending domain. Keep it server-side, outside Git, browser bundles, client environment variables and logs.
5. Install the key as the `RESEND_API_KEY` secret on the **API Worker** (`fairshare-api-sandbox`), not the web Worker. Configure these API bindings only after sender verification:

```
EMAIL_PROVIDER=resend
EMAIL_FROM=Fairshare <notifications@your-verified-domain>
PUBLIC_APP_ORIGIN=https://usefairshare.app
EMAIL_DELIVERY_ENABLED=true
```

`EMAIL_FROM` must be an actual verified sender mailbox. `PUBLIC_APP_ORIGIN` must be explicit HTTPS with no credentials, path, query or fragment. `EMAIL_DELIVERY_ENABLED` must equal `true` exactly. Missing/false disables email; incomplete enabled configuration fails startup rather than falsely advertising delivery. Node `DEMO_MODE=true` always disables the configured transport. Synthetic DEMO routes never send mail.

For Node, export the same values into the API process. The API does not automatically read dotenv. For local Workers, use a private ignored `.dev.vars` file. Hosted deployments retain remote variables through `keep_vars`; the hosted manifest deliberately does not set email values. Do not add credentials or enablement to a committed manifest. Do not enable mail against a database full of synthetic demo accounts.

## Named agreement invitations

The explicit endpoint is `POST /api/workspaces/:workspaceId/collaborations/:agreementId/people/:userId/invitation-email` with `{ "token": "<existing raw invitation token>" }`. The organizer must be signed in and verified. The server resolves the recipient from the stored named seat, checks the invitation hash, agreement, expiry, revocation and acceptance, and never accepts a client-supplied destination, sender, subject or URL.

The action emails the existing link; it does not rotate or invalidate a link already shared. Tokens remain hashed server-side and are not written to delivery records. The browser uses its existing invitation-link cache. If the device has no usable link, the organizer must explicitly request a replacement first. Links retain the existing `/invitation#token=agreement%3A...` form.

An emailed named invitation can only be accepted by an account whose email matches the stored destination. This does not mark the account verified. Ordinary copy-link invitations keep their existing bearer-link behavior. Joining never approves terms or moves money.

## Duplicates and failure semantics

- A durable `agreement_invitation_email` row reserves each invitation before the external call. Concurrent requests, page reloads and process restarts cannot cause a second email for that invitation. Provider idempotency uses the invitation ID, not a bearer token.
- Results distinguish `SENDING`, `PROVIDER_ACCEPTED` and `UNCONFIRMED`. Provider acceptance is **not** inbox delivery. Interrupted sends stay reserved; do not blindly clear them or retry. Check the provider dashboard first.
- On an uncertain send, the existing link remains usable, so the organizer can share it directly. Creating a replacement link is explicit and revokes the previous link; a delayed email with that old link will no longer work.
- Organizer limits and recipient limits apply across invitation replacements. Existing-account approval-email opt-outs block invitation and reminder sends. Reminder routes retain their existing 24-hour duplicate window.
- Recovery and verification routes retain their existing single-use, expiry, anti-enumeration and invalidation semantics. A failed authentication email may contain an invalidated link if it arrives late; request a new one using the app's normal limits.
- The adapter makes no automatic retries, rejects redirects, bounds provider requests, and returns sanitized errors. HTML escapes supplied names; each email includes a plain-text alternative. Credentials, tokens and provider response bodies are never included in errors.

There is no automatic durable outbound queue, delivery webhook ingestion, or automatic resend. Track delivery, bounces and complaints in Resend; the app deliberately never labels provider acceptance as delivered. Monitor quota and abuse, suppress bounced/complaining addresses at the provider, and disable sending if delivery quality deteriorates.

## Release and acceptance checklist

Before enabling any real sending, use only addresses whose owners authorized the test. Keep `EMAIL_DELIVERY_ENABLED` off until account, DNS, sender, key and public origin are verified. The API/DB change invalidates the hosted persistence acceptance scope, so follow the existing release gate rather than bypassing it.

1. Run formatting, all workspace tests, all type checks, builds and `npm run check:cloudflare -w @fairshare/api`. The Worker smoke uses mocked Resend responses and verifies disabled/enabled capability, verification, password recovery, named invitation acceptance and duplicate suppression. It makes no real email calls.
2. After an authorized deployment/configuration, verify one real verification email in an authorized inbox; check HTML, text, sender, SPF/DKIM/DMARC, and the exact HTTPS link/fragment. Check spam as well as inbox.
3. Complete verification as the intended account. Test wrong-account, expired and replayed authentication links, password reset and email-change confirmation. Do not record token-bearing links or credentials in screenshots or logs.
4. Send one named agreement invitation. Confirm the exact destination, review landing, signup/login return, wrong-account rejection, successful join and no implicit approval. Double-click and reload must not send duplicates.
5. Send a review reminder for a joined verified participant. It should open `/app/agreements/workspace/:workspaceId/:agreementId/agreement`. Verify opt-out, already-approved and non-organizer behavior.
6. Check the actual Resend accepted/delivered/bounced events. Test failures using provider-supported test addresses, never by emailing arbitrary people. An API receipt alone cannot prove inbox delivery.
7. Record authorized operational evidence without personal email contents or secrets. Disable by setting `EMAIL_DELIVERY_ENABLED=false`; then verify capabilities and controls revert to link sharing. Existing confirmation links retain normal expiry/revocation rules.

Official references: [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [Cloudflare domain setup](https://resend.com/docs/dashboard/domains/cloudflare), [idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
