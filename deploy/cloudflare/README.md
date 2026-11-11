# Automatic hosted deployment

Merges to `main` trigger `.github/workflows/deploy.yml`. Manual runs are restricted to `main`. Releases run serially and skip a commit superseded while checks ran.

## One-time setup

Add a dedicated `CLOUDFLARE_API_TOKEN` GitHub Actions repository secret. Scope it to the existing Cloudflare account, with Workers Scripts edit, Workers Routes edit, account settings read, and Containers/Cloudchamber permissions required by Wrangler. Do not use a personal Wrangler OAuth token, global API key, or PayPal credentials. Confirm exact permission names in Cloudflare when creating the token; use the minimum supported scope.

Existing Worker secrets stay in Cloudflare. The workflow never exports or replaces them. `wrangler.hosted.json` pins the existing parser image and preserves the sandbox authority and enabled payout settings. The default local Wrangler configuration remains unchanged. Parser image changes need a separately validated image update, not an implicit Docker rebuild.

## Release checks

Formatting, tests, types, builds, Worker runtime smoke, hosted-config assertions and the OpenNext build must pass before deployment. API deploys first, then web. Public-route and cross-origin checks run after publishing; they do not log in or move money.

If web deployment fails after API succeeds, the release is partial: inspect the Actions log before rerunning the same workflow. No automatic rollback touches the durable database. Deployments and versions remain visible in Cloudflare and Actions. This workflow is not active until merged and the token secret is configured.
