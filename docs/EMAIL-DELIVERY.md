# Email delivery acceptance

This is optional server-only configuration for legacy email routes. The primary collaboration flow uses private invitation links and copied review reminders, so it does not depend on email delivery. No email has been sent by this change and no mailbox delivery is claimed. Keep synthetic DEMO accounts separate from SANDBOX accounts.

## Configure only after authorizing the provider

The public `GET /api/auth/capabilities` response reports `{invitationDelivery:"LINK",emailDelivery:boolean}`. The link value remains available without a mail provider. `emailDelivery` is true only for a configured non-DEMO server transport and gates current web request controls for recovery, verification, and email change; confirmation routes remain registered with their existing token/authentication rules. The web UI does not expose legacy email-invitation creation, although the configured backend route remains available. The capability is not delivery evidence.

Use a sender domain verified with Resend. Store the API key outside Git and never put it in a NEXT_PUBLIC variable. Configure:

```
EMAIL_DELIVERY_ENABLED=true
EMAIL_PROVIDER=resend
EMAIL_FROM=Fairshare <noreply@your-verified-domain>
PUBLIC_APP_ORIGIN=https://your-fairshare-host
RESEND_API_KEY=<server-only secret>
```

Real email delivery requires an explicit HTTPS `PUBLIC_APP_ORIGIN`, without credentials, path, query or fragment. Loopback HTTP remains available only for local development paths that do not send email; it must not be used for a configured delivery transport. Configuration does not create DNS records, verify a sender, provision a provider account or authorize fees.

## Acceptance checklist

1. Use only addresses whose owners authorized this test. Start the API in SANDBOX mode, not DEMO.
2. Register and request verification. Verify an actual inbox receives the message, and the link reaches the correct web app.
3. Confirm while signed in with the matching address. Test wrong-account, expired and replayed links are rejected.
4. Invite an authorized recipient; confirm the inviter never sees the token, the recipient verifies their own address and can accept once.
5. Inspect the provider dashboard for accepted/delivered/bounced outcomes. Application `EMAIL_REQUESTED` means provider acceptance, not inbox delivery.
6. Test revoked and expired invitations. Never record token-bearing URLs or email bodies in screenshots/logs.

## Failure semantics

There is no blind automatic retry. A network timeout is ambiguous: the provider may already have accepted the message. The caller invalidates the token/revokes the invitation and asks for a new request, so a delayed email may contain an unusable link. The user must request another link. Provider calls use an idempotency key for the operation, but this implementation does not provide a durable outbound queue or delivery-webhook tracking.

Network errors and malformed provider JSON are normalized to safe error codes; raw provider bodies, credentials and tokens are not surfaced. Public endpoint responses remain generic. The existing request limits protect resend endpoints.

## Remaining work, not claimed complete

Actual sender verification, provider configuration, inbox delivery/bounce tests, durable outbox and delivery-event tracking, plus any support workflow for repeated failure. DEMO explicitly simulates verification and never sends real email.
