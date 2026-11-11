# Manual hosted deployment

`.github/workflows/deploy.yml` runs only when an operator dispatches it from `main`. A push or merge never deploys. The operator must explicitly confirm that restart, redeploy, restore, and rollback acceptance has passed for the hosted sandbox; the existing preflight rejects a missing or false acknowledgement. Releases run serially and skip a commit superseded while checks ran.

## One-time setup

Add a dedicated `CLOUDFLARE_API_TOKEN` GitHub Actions repository secret. Scope it to the existing Cloudflare account, with Workers Scripts edit, Workers Routes edit, account settings read, and Containers/Cloudchamber permissions required by Wrangler. Do not use a personal Wrangler OAuth token, global API key, or PayPal credentials. Confirm exact permission names in Cloudflare when creating the token; use the minimum supported scope.

Existing Worker secrets stay in Cloudflare. The workflow never exports or replaces them. `wrangler.hosted.json` pins the existing parser image and preserves the sandbox authority. The default local Wrangler configuration remains unchanged. Parser image changes need a separately validated image update, not an implicit Docker rebuild.

Persistence acceptance permits deploying the sandbox data path; it is not provider acceptance. Payouts, the eligibility acknowledgement, reconciliation, and automatic payouts remain disabled in the hosted manifest. Enabling any of them requires a separate reviewed manifest change after the corresponding PayPal sandbox capability, signed webhook, exact-recipient outcome, alarm recovery, and reconciliation acceptance has been recorded. Setting an environment flag alone is not that evidence.

## Release checks

The persistence preflight runs before install or verification. Formatting, tests, types, builds, Worker runtime smoke, hosted-config assertions and the OpenNext build must then pass before deployment. The checked API bundle is hashed after its smoke test and checked again immediately before upload. The hosted manifest disables Wrangler's custom rebuild and internal bundling, so deployment uploads that checked bundle rather than replacing it. API deploys first, then web. Public-route and cross-origin checks run after publishing; they do not log in or move money.

If web deployment fails after API succeeds, the release is partial: inspect the Actions log before rerunning the same workflow. No automatic rollback touches the durable database. Deployments and versions remain visible in Cloudflare and Actions. Merging the workflow and configuring the token do not deploy anything; an authorized operator must still dispatch the workflow with current persistence acceptance.
