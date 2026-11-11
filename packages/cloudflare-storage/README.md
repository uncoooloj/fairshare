# Cloudflare SQL prototype

The hosted sandbox uses this adapter; see `docs/CLOUDFLARE.md` for the deployed
source/version snapshot and checkpoint parity limits. The optional API Worker injects this adapter into identity,
agreement and payment handlers within one SQLite Durable Object; see
`apps/api/cloudflare/README.md` for verified local runtime coverage and remaining
deployment gates.

`DurableSqlDatabase` provides the SQL subset currently used by the API and maps
atomic callbacks to `storage.transactionSync`. It deliberately does not emulate
filesystem access, remote synchronous D1, `BEGIN`/`COMMIT`, or database ownership.
The caller must replace the current transaction function, not pass transaction
SQL through `exec`. Callbacks must be synchronous with no provider I/O. The
promise check catches mistakes but cannot cancel a previously started async task.

## Checks

- `npm test -w @fairshare/cloudflare-storage`: SQL bindings, rollback, duplicate
  capture, stale revision and rejected promise callback contract tests.
- `node packages/cloudflare-storage/test/workerd-smoke.mjs`: actual local workerd
  SQLite Durable Object rollback/uniqueness/affected-row checks. Requires the
  Cloudflare web toolchain's Miniflare 5 (via Wrangler); no account or deployment.
- The workerd smoke passes. Neither check proves production durability, hosted
  behavior, real provider behavior, backup/migration recovery, alarm recovery or
  full API behavior.

## Deployment boundary

The Node API still owns its local database. The optional Worker uses one global
financial-authority DO to preserve uniqueness and cross-table atomicity. Full
runtime migration evidence and remaining deployment gates are tracked in the API
Cloudflare README, not implied by these low-level adapter tests.
