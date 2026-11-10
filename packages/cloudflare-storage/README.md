# Cloudflare SQL prototype

**Not wired into the API and not deployed.** This is the persistence seam for a
SQLite-backed Durable Object, not a claim that Fairshare runs on Workers yet.

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
- Typecheck passes. Neither check proves production durability or full API behavior.

## Remaining deployment gates

1. Inject this storage interface instead of constructing `node:sqlite` in identity;
   separate filesystem initialization and remove WAL/busy-timeout PRAGMAs.
2. Run authenticated API handling inside the DO boundary, with a Workers-compatible
   router/transport. Validate password hashing and MFA crypto compatibility.
3. Keep a **single financial authority DO** initially: global capture uniqueness,
   cross-workspace identity, invitations and atomic intake currently share one DB.
   Per-workspace sharding requires a separate globally unique reservation protocol;
   merely splitting tables by workspace breaks existing guarantees.
4. Move bounded PDF/DOCX/OCR subprocess parsing to a stateless supported runtime.
   Never store the ledger on ephemeral Container disk. Retain document access and
   consent controls; verify any R2 document migration and failure cleanup.
5. Replace process reconciliation intervals with DO alarms or scheduled delivery,
   preserving leases, fencing, retry limits and read-only provider reconciliation.
6. Port full API adversarial tests, test restart/replay and duplicate webhooks in
   workerd, then verify signed sandbox events against the actual deployed ledger.
7. Plan account resources, secret provisioning, migrations/backups and rollback
   before deployment. No resources or credentials are provisioned by this package.
