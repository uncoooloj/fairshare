# Auth and persistence foundation

## Scope

Node 22.13+ `node:sqlite` database, synchronous transactions, WAL, foreign keys, 5s busy timeout, 0600 main database file. Use an access-restricted persistent volume for database plus WAL/SHM sidecars. Never publish the database, credentials, raw invitation tokens or session tokens.

`buildApp({dbPath, demo, clock})` creates an isolated app. Default is SANDBOX. DEMO and SANDBOX refuse to share a database. No live mode exists in this module; server rejects PAYPAL_ENV=live. Default binding is loopback. A health response is not provider verification.

Users are global identities; memberships scope every workspace resource. Roles are explicit OWNER, MEMBER and VIEWER. The creator is owner. Invitations can only add MEMBER or VIEWER. Owner can change/remove non-owner memberships; owner replacement/removal is deliberately unsupported. Permission checks read current membership for every request, so removal takes effect for existing sessions. Financial audit records and identities are not deleted when membership is removed.

## HTTP contract

- POST `/api/auth/register` `{name,email,password}` returns `{user,token,expiresAt}`. Password 12–256 characters; email normalized.
- POST `/api/auth/login` `{email,password}` returns same. Failed login has generic error; persistent per-IP and per-email throttles.
- GET `/api/auth/me`, POST `/api/auth/logout`.
- POST `/api/auth/password` `{currentPassword,newPassword}` revokes all sessions; sign in again.
- GET/POST `/api/workspaces`; POST body `{name}`.
- GET `/api/workspaces/:id`, `/members`, `/audit` (latest 100 events).
- PATCH `/api/workspaces/:id/members/:userId` `{role}` and DELETE same path: owner only; owner protected.
- POST `/api/workspaces/:id/invitations` `{email,role}`: owner only, creates a single-use invitation. DEMO returns a synthetic link only. SANDBOX sends through configured email delivery and does not return the secret token to the inviter. Never log tokens or embed them in analytics. Replacement revokes older unused invitations for that email/workspace.
- DELETE `/api/workspaces/:id/invitations/:invitationId`: owner revokes.
- POST `/api/invitations/accept` `{token}`: signed-in recipient with matching email (verified mailbox required in SANDBOX), unexpired/unrevoked token, no existing membership. Replay rejected. Expires in 48h.

Authenticated calls use `Authorization: Bearer <token>`. Tokens are 32 random bytes, SHA256-hashed in storage, expire after 7 days and are revoked on logout/password change. Passwords use salted scrypt. Responses have `Cache-Control: no-store`. No auth cookies/CORS are enabled: use a same-origin frontend proxy and keep tokens in memory, not URLs. A later cookie session design needs CSRF and secure cookie settings before adoption.

## Domain integration

`app.requireSession(request)` returns `{id,name,email}`. `app.requireWorkspace(request,id,roles?)` checks current membership and returns `{user,workspace}`. Default permits read for all roles. **Every domain handler must call this guard**, deriving workspace from stored resource ownership rather than trusting body fields. Use OWNER for rule approvals/payout execution unless the product explicitly grants narrower delegated powers. VIEWER must never mutate.

`store.getRecord(workspaceId,key)` / `putRecord(workspaceId,key,value,expectedVersion)` offer tenant-keyed JSON records with compare-and-swap versions. They are internal, not raw HTTP endpoints. `putRecord` owns a transaction; do not nest it inside `store.tx`. For multi-record money operations, use one explicit synchronous SQLite transaction and domain validations. Never await provider calls inside a database transaction. Reserve idempotent operations before provider calls, reconcile afterward.

## Known scope limits

Email verification and a server-only Resend adapter are implemented but no real delivery has been exercised. No password recovery, owner transfer, MFA or production account deletion yet. Demo verification is explicitly simulated and cannot cross into SANDBOX. Use synthetic identities for demo testing; real mail requires explicit operator setup and authorization. Rate limits use the app database and direct socket IP; do not blindly enable trustProxy. Database encryption, backup/restore and deployment quotas require hosting configuration. These are not claims of production readiness.

## Verified

13 tests cover session hashing, successful/failed login, logout/expiry, cross-tenant reads, injected roles, viewer restrictions, invitation mismatch/replay/expiry/revocation/replacement, password-change revocation, durable reopen, separate-mode guard, optimistic write conflicts, rate limits, immediate membership revocation and retained audit. Typecheck and build run separately. Additional email regressions cover wrong-account/expired/replayed tokens, sandbox fail-closed delivery, verified-recipient requirement, failed-send revocation, demo-only transport and Resend request/error handling. No live payment or email-provider call.

## Email verification and delivery

- POST `/api/auth/verification/request` with `{}` requires a session. User/IP throttled. Verification token lasts 30 minutes; new request invalidates old unused links.
- POST `/api/auth/verification/confirm` with `{token}` requires the same signed-in user. Success returns `{user,verificationMode}`.
- `user.emailVerified` is exposed in auth responses. SANDBOX invitations require verified email both for the inviter and accepting recipient.
- Link fragments are `/verify-email#token=…` and `/invitation#token=…`. Frontend must extract then clear the fragment, never log or send it to analytics. Confirmation uses POST.
- A failed or ambiguous mail send invalidates the token; an invitation send failure revokes it. A provider acceptance response means `EMAIL_REQUESTED`, not delivery to an inbox. User may safely retry with a new link.
- DEMO never invokes configured mail, returns `DEMO_ONLY` links and warning, and labels verification `DEMO_SIMULATION`. SANDBOX never falls back to exposed tokens.

To enable a real adapter, the operator must authorize sending and configure server-only `EMAIL_DELIVERY_ENABLED=true`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (verified sender), and `PUBLIC_APP_ORIGIN` (trusted HTTPS origin; loopback HTTP is limited to DEMO or delivery-disabled development). These values must not enter public frontend bundles. No key has been obtained, account created, provider called or fee incurred by this implementation. No outbound mail occurs by merely defining a RESEND_API_KEY. Tests inject an in-memory mail capture transport.
