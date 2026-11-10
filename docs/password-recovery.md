# Password recovery

- Sign-in → Forgot your password → submit verified email → email link → choose and confirm a new password → sign in again.
- Requires the existing opt-in email configuration: `EMAIL_DELIVERY_ENABLED=true`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, and trusted `PUBLIC_APP_ORIGIN`. No new provider or production credentials are provisioned by this change.
- Accounts must already have verified their email. Unverified and unknown accounts receive the same generic response, without a reset link. Missing mail configuration is reported explicitly and identically for all addresses.
- Request responses use a uniform 16-second window, including unknown accounts and delivery errors, to avoid revealing accounts through provider latency. Delivery is bounded to 15 seconds. If delivery cannot be confirmed, its token is invalidated, including when a late email may still arrive.
- 15-minute, random 256-bit tokens are stored only as SHA-256 hashes, emailed as URL fragments, removed from browser address bar after capture, and never returned by the API. There is no demo backdoor/link echo.
- Tokens are single-use, replaced by later requests, invalidated by password changes, and bound to the original email. Successful resets revoke all sessions and outstanding reset/email-verification links. Existing agreement records are not changed.
- Limits: 3 requests per normalized email / 30 minutes, 20 requests per IP / 30 minutes, 20 confirmation attempts per IP / 30 minutes.

## Acceptance checklist

1. Configure the authorized mail transport and verify a test account's actual mailbox.
2. Request a reset, receive the message, open link, set new password, confirm old password and old sessions fail.
3. Reusing the same link fails. Requesting a newer link invalidates the old link.
4. Unknown email has the same visible response and response window. Mail unavailable returns a truthful service-unavailable error.

Automated tests use a recording/failing transport, not a live mailbox. Actual delivery remains an environment acceptance check. Authenticator MFA is a separate optional feature that requires `FAIRSHARE_MFA_ENCRYPTION_KEY`; password reset does not remove or bypass an enabled authenticator. Social sign-in is not implemented here. See [mfa.md](mfa.md).
