# Sandbox payment flow and verification boundary

The API registers sandbox routes under each authenticated collaboration. Only its organizer can create checkout, capture/reconcile payment, dispatch fixed allocations or reconcile payout status. Collaborators can read the collaboration's payment and payout ledger and set only their own sandbox PayPal recipient ID. No endpoint accepts arbitrary allocation amounts for payouts.

1. POST `.../payments` with `{requestKey, amountCents}` reserves an immutable operation under active unanimously approved rules. A repeat key with different amount or collaboration is rejected. Return includes sandbox approval URL after provider order creation.
2. Buyer approves in PayPal sandbox; return/cancel callbacks make no claims about payment completion.
3. POST `.../payments/:paymentId/capture`, then reconcile. Provider read must match order/reference/capture/currency/gross and fee accounting before atomic allocation. Changed active rule version blocks allocation for explicit reconciliation instead of silently applying new terms.
4. POST `/api/paypal/webhook` verifies PayPal signature, persists event fingerprint and action, rejects changed payloads under existing ID, and processes capture/hold/payout reconciliation. Known-event processing failures remain PENDING and return 503 so provider retries. Unsupported verified event types remain PENDING and return 400; unknown IDs are retained, never silently credited. See [webhook coverage and retry runbook](PAYPAL-WEBHOOKS.md).
5. PUT `/api/auth/payout-account` with `{email}` stores the current user's account-level PayPal email destination. Legacy saved merchant-ID destinations remain supported by the payout adapter. POST `.../payouts/dispatch` with `{captureId}` reserves each exact allocation once and submits it to sandbox. It is a dispatch command, not discretionary approval of shares. Dispatch remains explicit; the opt-in reconciliation worker only reads and reconciles known operations.
6. Repeated dispatch never sends a second payment for existing operation. POST `.../payouts/:payoutId/reconcile` verifies provider item and updates status. Acceptance is PENDING, not paid. Frozen recipient/amount remain unchanged if profile changes.

## Deliberate fail-closed limits

- Unknown order creation/payout write outcomes need operator investigation; the API will not blindly reissue a write. Agreement-scoped recovery can recheck known references and exclusively matched, previously verified event plans. Unidentified or unsupported events require operator investigation or a signed provider resend; no action deletes the receipt or clears a liability hold.
- An adverse event arriving before capture allocation blocks allocation; one arriving afterward preserves liabilities and puts collaboration on hold. No guessed automatic release or clawback.
- Full checkout refunds require explicit confirmation and return only to the original payer. Never-submitted payout reservations may be cancelled atomically with the refund reservation and agreement hold; provider-submitted or uncertain payouts require operator liability review. Invoice refunds remain in PayPal, not this checkout refund form.
- Missing recipient, payment hold, missing provider fee data and changed rules block progression. Payout eligibility flags are off by default. Payouts may require sender balance independent of the captured checkout.
- Provider credentials must stay server-side. Configure merchant ID and webhook ID. Current test success uses mocked providers; historical OAuth-only sandbox evidence does not establish Fairshare checkout or payout verification.
- No production/live money mode. No escrow or guaranteed live marketplace splitting claim.

Tests cover immutable checkout retry keys, access isolation, duplicate verified events, mismatched event IDs, fee requirements, duplicate payout dispatch, provider-verified item statuses, unknown outcomes and reversal before/after capture.

## Source labels

Checkout accepts optional `source: {type: "OTHER", name: "Bandcamp"}` or `{type: "PAYPAL"}`. Other requires 1–100 non-control characters. Omission defaults to PayPal, including existing records. Source attribution is immutable under the checkout request key; changing it on a retry returns `IDEMPOTENCY_CONFLICT` instead of creating another payment.

`source_type` and `source_name` are organizer-entered labels returned with payment records. They are never provider evidence, do not import external revenue and cannot mark money confirmed. All actual checkout/capture verification still uses PayPal sandbox. The UI retains the original uncertain-request key when a label changes.

## Scoped adverse events and refund reservations

Known verified capture/order/invoice identifiers scope an adverse event to the
matching capture or agreement. An explicit unmatched capture does not freeze
unrelated agreements. Missing, ambiguous, malformed and unsupported evidence
remains globally blocking for automatic payouts and new refunds. This never
releases an existing domain hold.

Recovery lists only pending events that belong exclusively to the current
organizer's agreement. Recheck invokes the existing verified plan and fresh
provider reads; it does not reinterpret unknown raw payloads or retry payment writes.
Unknown event types must be redelivered with a valid signature after adding support.

A full refund can cancel only WAITING_RECIPIENT, AUTO_HELD, RESERVED or HELD payout
rows whose batch and item IDs are both explicitly null. Rows remain auditable as
CANCELLED_FOR_REFUND. SUBMITTING, OUTCOME_UNKNOWN, terminal statuses and any provider
identity are never treated as never-submitted. A concurrent dispatcher that claims
first blocks the refund. Existing refund requests remain idempotent.

## Connect with PayPal (sandbox, optional)

A collaborator can confirm their payout email with Log in with PayPal instead of typing it. PayPal returns the account's email, whether PayPal has confirmed it, and the payer ID. Fairshare saves the email as the account-level payout destination with `verified=1`, `payer_id` and `verified_at` (additive columns on `fairshare_payout_accounts`, added at startup if missing). Only the owner sees "Connected · m•••@example.com · Verified by PayPal"; organizers still see only "Ready to be paid". Typing a new email clears verification. Sandbox only; live use needs PayPal's scope review, which "typically" takes weeks ([Log in with PayPal: build](https://developer.paypal.com/log-in/build/)).

### Flow

1. `GET /api/auth/paypal/connect?returnTo=/app/...` (signed in) stores a single-use nonce bound to the user and the current session, and returns `{authorizeUrl}` with `state = nonce.expiry.HMAC` (10 minutes). Rate limit: 10 per person per 15 minutes.
2. The browser goes to `https://www.sandbox.paypal.com/connect` with `response_type=code`, the scopes below and `redirect_uri = PAYPAL_IDENTITY_RETURN_URL`.
3. PayPal returns to the web page `/paypal/return?code&state`. The Fairshare session cookie is `SameSite=Strict`, so a cross-site redirect cannot carry it; the page therefore makes a same-origin `POST /api/auth/paypal/callback {code, state}` (origin-checked by the web proxy), then strips the code from the address bar.
4. The callback verifies the HMAC and expiry, consumes the nonce, and requires the same user and session that started it. Only then does it exchange the code server-side at `/v1/oauth2/token` (`grant_type=authorization_code`, Basic client auth) and call `/v1/identity/openidconnect/userinfo` ([Show user profile information](https://developer.paypal.com/api/identity/v1/userinfo-get)). An unconfirmed or missing email saves nothing (`PAYPAL_EMAIL_UNVERIFIED`). Success is audited as `PAYPAL_CONNECTED`.
5. The return page sends the person back to the page that started it with `?paypal=connected|unverified|failed|cancelled`.
6. `DELETE /api/auth/paypal/connect` clears verification and the payer ID, keeps the email so payouts aren't interrupted, and audits `PAYPAL_DISCONNECTED`.

Tokens, codes and provider error bodies are never logged or returned to the browser.

### Which recipient type is sent

Payouts still go to the verified email with `recipient_type: EMAIL`. PayPal says the payer ID is "used in PayPal APIs such as the Payouts API" ([scope attributes](https://developer.paypal.com/log-in/references#scope-attributes)), but EMAIL is also a first-class receiver ([Payouts: create batch](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-post)), and nothing in the docs makes PAYPAL_ID safer once PayPal itself has confirmed the email. One code path for typed and verified destinations keeps reconciliation and the frozen operation rows unchanged. The payer ID is stored for a later switch, and the exact userinfo key for it (`payer_id`) is not shown in PayPal's sample, so it is optional.

### Sandbox app setup

1. Sign in at [developer.paypal.com](https://developer.paypal.com/dashboard/) and switch the dashboard to **Sandbox**.
2. Open **Apps & Credentials** and select the existing Fairshare sandbox REST app (or create one).
3. Under **Other features**, tick **Log in with PayPal**, then open **Advanced Settings** ([Log in with PayPal: build](https://developer.paypal.com/log-in/build/)).
4. Set the **Return URL** to the web page, e.g. `http://localhost:3000/paypal/return` locally or `https://<web origin>/paypal/return`. It must match `PAYPAL_IDENTITY_RETURN_URL` exactly.
5. Under the information to share, tick **Email address** and **PayPal account ID (payer ID)** / account verification status, which map to the scopes `openid email https://uri.paypal.com/services/paypalattributes` ([scope attributes](https://developer.paypal.com/log-in/references#scope-attributes)).
6. Enter the **Privacy policy URL** and **User agreement URL** (required by the form), then save.
7. Sign in during the flow with a sandbox personal account from **Testing Tools → Sandbox accounts**; real PayPal accounts don't work in sandbox.

### Environment

| Variable                                                     | Meaning                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAYPAL_IDENTITY_RETURN_URL`                                 | Required to enable the button. `https://…/paypal/return`, or `http://localhost…` for local use.                                                                                                                                                                 |
| `PAYPAL_IDENTITY_CLIENT_ID`, `PAYPAL_IDENTITY_CLIENT_SECRET` | Optional. Log in with PayPal is a feature of a REST app, and the build guide uses that app's client ID and secret for the code exchange, so by default the existing `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` are reused. Set these only to use a separate app. |

The OAuth state key is derived server-side from the client secret. With no return URL or credentials, or in `DEMO_MODE`, the button is hidden and the typed email path works unchanged. The Cloudflare worker entry does not enable it yet.
