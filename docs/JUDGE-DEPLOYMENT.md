# Judge-ready deployment plan

Status: prepared blueprint, **not deployed**. No hosting account, charge, terms acceptance, DNS change, public tunnel or secret upload is performed by these files. Docker image build is not yet verified. The passing workspace build does not establish deployed readiness.

## Deployment target

The owner selected **Cloudflare**. See [CLOUDFLARE.md](CLOUDFLARE.md) for current compatibility work and migration gates. The two-service persistent-host topology below is a fallback reference, not permission to deploy to a different provider.

## Original persistent-host topology

Use two services from the same commit: Next.js web and one long-running Node API. Put the API's SQLite database on an attached persistent disk. Render is a candidate because it is a hackathon sponsor; select a paid persistent-disk-capable plan only after the owner approves current pricing, region, data location and billing. Do not assume a free service provides persistence or availability. Hosting elsewhere is acceptable; avoid migration solely for a sponsor badge.

- Web: `npm run start -w @fairshare/web -- --hostname 0.0.0.0 --port 3000`.
- API: `npm run start -w @fairshare/api`, `HOST=0.0.0.0`, platform service port.
- Build: repository root, Node 22.16+ (pin and verify an actively patched supported release before public deployment), `npm ci && npm run typecheck && npm run build`.
- Web server calls API through `FAIRSHARE_API_URL`; credentials stay in the API process. Browser calls the same-origin Next BFF, not a public credential-bearing API client.
- Public HTTPS API origin must reach PayPal return/cancel and webhook routes. API data routes still require bearer auth. Prefer an ingress allowlist for public provider routes, with private service networking for web→API; validate exact implemented route names from `docs/PAYMENTS.md` before configuration.
- **One API instance, one disk, no autoscaling** with the current SQLite model. Do not put SQLite on ephemeral function storage, copy separate live DBs to multiple instances, or use network-mounted shared SQLite as a shortcut. Postgres migration is a separate project if scale requires it.

`deploy/Dockerfile` is an optional container candidate for this topology. Both services can use the same built image with different commands. It retains runtime TypeScript and `tsx` intentionally because workspace package exports currently point to source. `.dockerignore` excludes environment files, databases and key material. Supply secrets at runtime, never as image build arguments. Inspect the actual build context and image contents before uploading.

## Demo and provider acceptance must be separate

1. **Judge DEMO:** explicit `DEMO_MODE=true`, fresh synthetic database, no PayPal/Cloudflare/mail keys. It must label simulated verification and payments. Use seed command only when available and verified on the final branch. Never expose real contracts or customer data in a judge fixture.
2. **SANDBOX acceptance:** `DEMO_MODE=false`, different persistent database, actual PayPal sandbox credentials and verified merchant ID. Disable payouts until eligibility and recipient outcomes have been tested. Do not mix DEMO users or financial events into the sandbox database.
3. Live mode is not supported or authorized. No deployment checklist can waive that.

A local laptop or temporary tunnel is not durable judging access. Keep the hosted service and its test instructions available through December 15, 2026 if choosing hosted access. The rules also allow a reproducible public-repository run path; it must be independently tested on a clean machine and cannot rely on the owner's private credentials.

## Environment contract

See `deploy/api.env.example` and `deploy/web.env.example`; these contain names, not secrets. Set exact HTTPS origins after URLs are assigned. Real email needs an authorized sender, configured provider and inbox verification; a successful send response is not proof of inbox delivery. Sandbox needs email ownership verification; don't weaken it merely to make judge access easier. A separately labelled DEMO is the fallback.

- `DATABASE_PATH` must be an absolute path inside the mounted volume, e.g. `/var/lib/fairshare/sandbox.db`.
- Persist and protect SQLite `-wal` and `-shm` sidecars too. Restrict the volume directory to the app user; database chmod alone doesn't secure all backups/sidecars.
- Keep PayPal secret, Cloudflare token and email API key in approved server-side secret storage. Never `NEXT_PUBLIC_*`, client source, URLs, screenshots, logs, git or sample fixtures.
- Set `PUBLIC_APP_ORIGIN`, `PUBLIC_API_URL` and `FAIRSHARE_WEB_ORIGIN` to the verified deployment origins. Test the BFF Host/Origin behaviour behind the actual proxy. Do not bypass CSRF checks or blindly enable `trustProxy`.

## Persistence, backup and restart acceptance

Before judge access:

- Create synthetic user/agreement, approve a version, then restart and redeploy API; confirm identical user, version, ledger and audit events remain.
- Take a consistent SQLite backup using the SQLite backup API or `VACUUM INTO` with a unique destination, not a plain copy of a live WAL database. Encrypt/restrict backup storage and approve any external destination before transmission.
- Restore into a separate test database, run integrity checks and confirm balances, approvals and idempotency reservations. Do not restore over the live database during testing.
- Record the immutable application commit, schema compatibility, backup time and restore procedure. Rolling code back may not roll schema back; do not guess downgrade safety.
- Run only one payment writer. Preserve idempotency reservations across retries/restarts; never reset the DB to clear an uncertain operation.

No backup job is installed by this document. Retention, storage destination and charges need an explicit deployment decision.

## Public release acceptance gates

- Clean install/tests/typechecks/build at the exact published head.
- Browser testing through the deployed origin: register/sign in, secure HttpOnly cookie, CSRF rejection, logout, tenant isolation, verification/invite routes and upload limits. In particular verify `Secure` cookie flag behind TLS termination; current BFF derives it from request URL protocol.
- Complete agreement creation→source review→proposal→all-party approval→activation→allocation preview, including reload/revoked membership.
- Real Cloudflare synthetic extraction, exact source citations and human-review requirement; no private-document transmission without authorization.
- Actual sandbox buyer approval, capture retrieval, fees/merchant/reference matching, refund, payout item outcomes and signed webhook delivery. Batch acceptance alone is not recipient receipt. Avoid duplicate writes after network uncertainty.
- Restart during a reserved payment operation, reconcile using provider evidence, confirm no duplicate allocation/payout.
- Public repository secret/history and dependency review, licence/asset rights, sanitized demo accounts, under-three-minute video and judge instructions. Public visibility requires owner approval.
- Monitoring must not log secrets, raw contracts, passwords, invitation fragments or provider access tokens. Alert on health failures, disk space and unresolved payment operations. Current application is not production-certified.

## Inputs still needed / deferred decisions

- Hosting choice and approved spending limit; account availability and deployment authority.
- Region, domain and origin URLs; any new terms/permissions.
- Approved secret-storage destination and transfer method.
- Real email sender/provider authorization and access.
- Sandbox buyer approval and payout feature eligibility.
- Backup destination/retention and judge access policy.
- Browser acceptance on the final deployed build.

Until these gates pass, describe the system as a tested implementation with outstanding provider/deployment acceptance, not production-ready.
