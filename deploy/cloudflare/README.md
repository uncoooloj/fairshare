# Deploy only on explicit instruction

`.github/workflows/deploy.yml` publishes only when manually dispatched on `main` after explicit operator instruction. Merging a PR never starts a deployment. It also checks Cloudflare-specific safeguards and build artifacts on pull requests without deploying; the normal CI workflow owns the duplicate format, full-test, type and ordinary-build checks. Manual retries are available on `main`; other branches cannot publish. Superseded PR release checks are cancelled, while main and manual releases run serially and skip a commit superseded while checks ran.

Publication is **fail-closed** until both a current hosted persistence acceptance receipt and a dedicated Cloudflare token are configured. Merging this workflow alone is not evidence of persistence acceptance and does not bypass the gate. This extends the manual-only release safeguards merged in PR #64 with automatic triggering and scope-bound acceptance.

## One-time setup and acceptance renewal

1. Add a dedicated `CLOUDFLARE_API_TOKEN` GitHub Actions repository secret, scoped to the existing Cloudflare account and the minimum Workers Scripts, Workers Routes, account-read and Containers/Cloudchamber permissions required by Wrangler. Confirm current permission names in Cloudflare. Do not use a personal Wrangler OAuth token, global API key, or PayPal credentials. Existing Worker secrets stay in Cloudflare.
2. On a complete checkout of the proposed release, run `node deploy/cloudflare/persistence-gate.mjs --fingerprint`. The workflow also records this SHA-256 in its summary. The hash identifies a conservative acceptance scope: all API files, shared packages, deployment files, the release workflow, root dependency manifests, and web Wrangler/build/dependency configuration and scripts. It includes new files and removals. Generated ignored output is excluded.
3. An authorized operator must complete and record **hosted** restart, redeploy, restore and rollback acceptance for that scope and the sandbox target below. Keep private data, provider payloads and credentials out of evidence. Local runtime tests are useful but are not a substitute for hosted acceptance. Use the separately authorized hosted acceptance procedure; this workflow does not bootstrap or execute it.
4. Only after those checks genuinely pass, create the repository Actions **variable** `FAIRSHARE_PERSISTENCE_ACCEPTANCE` with this JSON shape, replacing the placeholders with actual evidence. Do not copy this template as an acceptance claim:

```json
{
  "version": 1,
  "scopeSha256": "<SHA-256 from the accepted checkout>",
  "target": {
    "worker": "fairshare-api-sandbox",
    "apiOrigin": "https://fairshare-api-sandbox.udaleamehoj.workers.dev",
    "webOrigin": "https://usefairshare.app"
  },
  "checks": {
    "restart": true,
    "redeploy": true,
    "restore": true,
    "rollback": true
  },
  "acceptedBy": "<operator who performed acceptance>",
  "acceptedAt": "<actual ISO-8601 timestamp>",
  "evidenceUrl": "<HTTPS link to the recorded acceptance>"
}
```

The gate checks the target, exact scope hash, each acceptance assertion, operator, timestamp and evidence-link syntax. It does **not** fetch the evidence or certify its truth: this remains an explicit operator attestation. A boolean, manual-run checkbox, or `FAIRSHARE_API_PERSISTENCE_VERIFIED=true` in the runner environment cannot satisfy the gate; the separately documented explicit sandbox waiver is the only manual exception. The existing origin/persistence preflight is invoked only after the receipt is accepted, and is skipped only under that waiver.

Every release recomputes the hash before dependency installation and immediately before publication. Any API, storage, shared-package, dependency or deployment change (including web deployment/build configuration) invalidates the prior receipt, even if it looks harmless. Repeat hosted acceptance and replace the receipt for the new hash; never refresh the hash without the tests. Frontend-only and documentation-only changes can reuse a matching receipt. The scope deliberately includes backend tests and deployment documentation for conservative invalidation. Remote storage, bindings, migration or operational changes also require the operator to revoke the variable and repeat acceptance; a source hash cannot detect remote changes. Remove the variable to block new releases. Updating/removing a variable does not revoke a job that already loaded its receipt; cancel that run as well.

After setup, future matching-scope merges deploy without another manual dispatch. A previously blocked run can be retried manually on current `main` after genuine acceptance is recorded. For an explicitly authorized sandbox-only release, a `workflow_dispatch` on `main` may set the required `waive_persistence` boolean input to `true`; this skips both receipt checks and records the actor, commit, target and the four checks not performed in the run summary. Pushes to `main`, pull requests, and manual runs with the default `false` value remain fail-closed. This waiver is not a persistence acceptance receipt and must not be used for production. Protect `main` with the normal `verify` check and the `Check and release Cloudflare` PR check before enabling automatic publication. Repository protection and credential/variable setup are separate operator actions, not changes made by this PR.

## Preserve hosted payment settings

`apps/api/wrangler.hosted.json` uses `keep_vars: true` and deliberately **omits** `PAYPAL_PAYOUTS_ENABLED`, `PAYPAL_PAYOUTS_ELIGIBILITY_CONFIRMED`, `PAYPAL_RECONCILIATION_ENABLED` and `PAYPAL_AUTOMATIC_PAYOUTS_ENABLED`. The deploy command also passes `--keep-vars`. Existing hosted values are preserved, not forced on or off. Missing values retain the application's disabled defaults. The local Wrangler manifest remains unchanged with its existing defaults.

Cloudflare documents that [`--keep-vars`](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy) preserves existing variables; secrets are retained regardless. Variables explicitly present in a manifest can still replace their existing values, which is why the capability variables are omitted rather than set to false. Hosted-config tests reject any attempt to add them to this release manifest.

Preserving a flag is not evidence that its capability has passed provider acceptance. Enabling or changing payment capabilities remains a separate authorized operation requiring the corresponding PayPal sandbox capability, signed-webhook, exact-recipient outcome, alarm recovery and reconciliation evidence. This workflow neither performs those checks nor changes those flags. PayPal secrets can still enable sandbox checkout/invoicing; this workflow does not claim all payments are disabled.

## Release checks and recovery

All hosted guard tests run before dependency installation, including negative/stale-receipt tests. PRs then install dependencies, run the Worker runtime smoke and OpenNext build, while the normal CI workflow supplies the duplicate format, workspace-test, type and ordinary-build checks. Main and manual releases run the complete validation set before publication. The checked API bundle is hashed after its smoke test and rechecked immediately before upload. The hosted manifest disables custom rebuilding and internal bundling so deployment uploads that checked bundle. The existing parser image is pinned by digest; parser image changes need separate validation rather than an implicit Docker rebuild. Durable Object names, bindings and migrations are retained.

API deploys first, then web. Public-route and cross-origin checks run after publishing; they do not log in, call a payment provider or move money. They do not establish private-account, provider or persistence acceptance, nor exact live artifact parity.

If web deployment fails after API succeeds, the release is partial. Inspect the Actions and Cloudflare deployment logs before retrying. No automatic rollback touches the durable database. Keep a separately tested backup/restore/rollback procedure. No token, acceptance receipt, deployment, provider operation or change to live settings is performed merely by opening this PR.
