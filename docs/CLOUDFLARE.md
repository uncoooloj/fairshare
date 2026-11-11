# Cloudflare deployment

Hosted sandbox snapshot, November 10, 2026: the primary web URL is https://usefairshare.app; https://fairshare-web.udaleamehoj.workers.dev remains an allowed same-host entry point. User-facing invitation and copied dashboard links use the primary custom domain when the app was opened through that retained Workers URL. Other deployments, including local loopback, retain their own origin. The API is https://fairshare-api-sandbox.udaleamehoj.workers.dev. Deployment verification reported sign-in/secure cookies, CSRF rejection, intake replay, activation/stale revision, DOCX/original-byte preservation, real scanned-PDF OCR and Workers AI returning review-required output.

The custom-domain verification used commit `d64e7e0631fba24c28d88cf38029869e16d0eba1` atop PR31. Web version: `d9024d5d-b029-44f2-81a5-1c73a7bd8ef1`; API version: `ede36713-1e8b-447a-abe0-57d74daef905`. The API deploy reused the verified existing parser registry image through a temporary manifest override; repository source retains the Dockerfile. This checkpoint ports those fixes onto the current upstream stack; **exact deployed/checkpoint parity requires redeploying this checkpoint**. Real PayPal capture/payout/refund and signed-webhook acceptance remain separate, not implied by these checks.

## What ships where

| Component                          | Target                                         | Remaining work                                                                                |
| ---------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Next web + same-origin BFF         | Workers with OpenNext                          | Hosted auth/CSRF verified; current checkpoint redeploy and device QA pending                  |
| Agreement/identity/ledger database | Single-authority Durable Object SQLite adapter | Local runtime/restart checks exist; deployed storage, backup and migration acceptance pending |
| API routes                         | Optional Worker adapter reusing API handlers   | Local workerd verification passes; full deployed acceptance pending                           |
| PDF/OCR                            | Private stateless Container parser adapter     | Linux/amd64 image and actual hosted OCR verified; continued load/cleanup acceptance           |
| Reconciliation                     | Opt-in Durable Object alarms                   | Deployed alarm recovery acceptance pending; existing leases/fencing retained                  |
| Original documents                 | Same private authority DO SQL                  | Transactional originals retained with existing authorization and 5 MiB bound; no R2 required  |
| AI extraction                      | Existing Workers AI integration                | Retain consent, grounded citations and human approval                                         |

Do not deploy today's SQLite file on a Container disk, Worker temporary filesystem or R2 FUSE and call it durable. A Container's associated Durable Object storage does **not** automatically persist its filesystem. Snapshots are point-in-time copies, not transaction-by-transaction financial durability. D1 is asynchronous; it is not a drop-in replacement for `DatabaseSync` or `BEGIN/COMMIT` code.

The deployment uses two Workers, two Durable Object classes and one bounded private parser Container (maximum one instance, one-minute idle sleep, no internet egress). R2 and D1 are not required. Node API hosting remains a local-development option, not a substitute for this all-Cloudflare target.

The optional backend Worker routes every request to one named SQLite Durable Object and reuses the existing API business handlers through a narrow no-eval router. See `apps/api/cloudflare/README.md` for its local verification and remaining deployment gates. Existing local SQLite data is not automatically migrated.

## Local build

```sh
npm ci
npm run cloudflare:build -w @fairshare/web
npm run cloudflare:preview -w @fairshare/web
node --test deploy/cloudflare/preflight.test.mjs
npm run check:cloudflare -w @fairshare/api
```

OpenNext adapts the existing Next app. A framework migration is a separate decision from the API and storage work.

The Worker has no shared application cache configured. Keep authenticated responses `private`/`no-store`; do not cache cookies, agreement documents or payment state. `nodejs_compat` supports the web adapter; it does not make the separate Node API Worker-compatible.

The checked local API smoke covers authentication, validation, tenant isolation, atomic intake/retry, source-bound proposals, approval/activation, stale revisions, Durable Object restart persistence, and mocked PayPal create/capture, net-fee allocation and duplicate retry safety. It does not use merchant credentials or make provider requests, so it is not real provider evidence.

## Deployment gate

Before running `cloudflare:deploy`, provide stable `FAIRSHARE_API_URL` and `FAIRSHARE_WEB_ORIGIN` HTTPS origins and set `FAIRSHARE_API_PERSISTENCE_VERIFIED=true` **only after** restart/redeploy/restore tests. The script validates configuration, not actual durability. Supply these two non-secret runtime variables in the Worker's environment as well; shell environment is not automatically deployed as Worker bindings. Do not place PayPal or AI credentials in the web Worker.

The [hosted release workflow](../deploy/cloudflare/README.md) runs on merges to `main`, but publication fails closed until a recorded hosted persistence acceptance receipt matches the backend/deployment source fingerprint. API, storage, shared-package, dependency and deployment changes invalidate that receipt. PRs check the release path without publishing. Hosted payment capability variables are deliberately omitted from the release manifest and preserved with `keep_vars`; this neither enables them nor establishes provider acceptance.

Use approved account access and secret storage. No `wrangler login`, secret upload, DNS change or paid-resource creation is automatic. Do not commit `.dev.vars`, `.wrangler`, generated bundles or credentials.

Hosted acceptance remains: sign-in/cookie/CSRF checks; upload→review→all-party approval; cross-tenant rejection; preserved ledger after restart; duplicate/reordered signed PayPal webhook handling; idempotent payout reconciliation; parser privacy/bounds; alarm recovery; backup, migration and rollback. Register the stable public API webhook URL only after routing and signature checks work. A verified isolated webhook receiver is not proof the app ledger reconciles.

## Historical sources (checked November 10, 2026)

- https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/
- https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- https://developers.cloudflare.com/containers/faq/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
