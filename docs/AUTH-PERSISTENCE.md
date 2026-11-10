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
- POST `/api/workspaces/:id/invitations` `{email,role}`: owner only, returns a single-use token. No email is sent. Share privately with named recipient; never log token or embed it in analytics. Replacement revokes older unused invitations for that email/workspace.
- DELETE `/api/workspaces/:id/invitations/:invitationId`: owner revokes.
- POST `/api/invitations/accept` `{token}`: signed-in recipient with matching email, unexpired/unrevoked token, no existing membership. Replay rejected. Expires in 48h.

Authenticated calls use `Authorization: Bearer <token>`. Tokens are 32 random bytes, SHA256-hashed in storage, expire after 7 days and are revoked on logout/password change. Passwords use salted scrypt. Responses have `Cache-Control: no-store`. No auth cookies/CORS are enabled: use a same-origin frontend proxy and keep tokens in memory, not URLs. A later cookie session design needs CSRF and secure cookie settings before adoption.

## Domain integration

`app.requireSession(request)` returns `{id,name,email}`. `app.requireWorkspace(request,id,roles?)` checks current membership and returns `{user,workspace}`. Default permits read for all roles. **Every domain handler must call this guard**, deriving workspace from stored resource ownership rather than trusting body fields. Use OWNER for rule approvals/payout execution unless the product explicitly grants narrower delegated powers. VIEWER must never mutate.

`store.getRecord(workspaceId,key)` / `putRecord(workspaceId,key,value,expectedVersion)` offer tenant-keyed JSON records with compare-and-swap versions. They are internal, not raw HTTP endpoints. `putRecord` owns a transaction; do not nest it inside `store.tx`. For multi-record money operations, use one explicit synchronous SQLite transaction and domain validations. Never await provider calls inside a database transaction. Reserve idempotent operations before provider calls, reconcile afterward.

## Known scope limits

No email delivery, verified-email proof, password recovery, owner transfer, MFA or production account deletion yet. Manual invitation tokens prove knowledge of the token, not independent email ownership. Only synthetic test identities are appropriate until verified email and a secure recovery process are implemented. Rate limits use the app database and direct socket IP; do not blindly enable trustProxy. Database encryption, backup/restore and deployment quotas require hosting configuration. These are not claims of production readiness.

## Verified

7 tests cover session hashing, successful/failed login, logout/expiry, cross-tenant reads, injected roles, viewer restrictions, invitation mismatch/replay/expiry/revocation/replacement, password-change revocation, durable reopen, separate-mode guard, optimistic write conflicts, rate limits, immediate membership revocation and retained audit. Typecheck and build run separately. No live payment call.
