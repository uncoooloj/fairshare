# Cloudflare deployment

Target: Cloudflare. Status: OpenNext build and Wrangler deployment dry-run pass; **not deployed**. Local workerd preview is blocked in this execution sandbox by `uv_interface_addresses`, including with an explicit loopback bind. Runtime/browser acceptance remains pending.

## What ships where

| Component                          | Target                                   | Remaining work                                                                        |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Next web + same-origin BFF         | Workers with OpenNext                    | Build/preview acceptance, account access and stable API origin                        |
| Agreement/identity/ledger database | Durable Object SQLite candidate          | Port synchronous `node:sqlite` stores; test transactions and tenant boundaries        |
| API routes                         | Worker or container adapter              | Fastify and Node assumptions require deliberate migration                             |
| PDF/OCR                            | Stateless Cloudflare Container candidate | Poppler/Tesseract cannot run as Worker subprocesses; bounded private transfer/cleanup |
| Reconciliation                     | Durable Object alarms or Queues          | Replace interval lifecycle; preserve leases, fencing and idempotency                  |
| Original documents                 | Private R2 candidate                     | Authorized object access, size limits, deletion and DB/object consistency             |
| AI extraction                      | Existing Workers AI integration          | Retain consent, grounded citations and human approval                                 |

Do not deploy today's SQLite file on a Container disk, Worker temporary filesystem or R2 FUSE and call it durable. A Container's associated Durable Object storage does **not** automatically persist its filesystem. Snapshots are point-in-time copies, not transaction-by-transaction financial durability. D1 is asynchronous; it is not a drop-in replacement for `DatabaseSync` or `BEGIN/COMMIT` code.

The quickest intermediate path is Workers frontend + the existing Node API on a verified persistent host. This is **not** an all-Cloudflare deployment; do not silently substitute it for the requested target. A temporary laptop tunnel remains only a test endpoint. No provider resources, account terms, billing or secret upload is performed by this change.

## Local build

```sh
npm ci
npm run cloudflare:build -w @fairshare/web
npm run cloudflare:preview -w @fairshare/web
node --test deploy/cloudflare/preflight.test.mjs
```

OpenNext is deliberately the adapter for the existing Next app, not a simultaneous framework rewrite. Cloudflare now recommends vinext for new Next apps; evaluate that separately rather than combine framework and database migrations before the demo.

The Worker has no shared application cache configured. Keep authenticated responses `private`/`no-store`; do not cache cookies, agreement documents or payment state. `nodejs_compat` supports the web adapter; it does not make the separate Node API Worker-compatible.

## Deployment gate

Before running `cloudflare:deploy`, provide stable `FAIRSHARE_API_URL` and `FAIRSHARE_WEB_ORIGIN` HTTPS origins and set `FAIRSHARE_API_PERSISTENCE_VERIFIED=true` **only after** restart/redeploy/restore tests. The script validates configuration, not actual durability. Supply these two non-secret runtime variables in the Worker's environment as well; shell environment is not automatically deployed as Worker bindings. Do not place PayPal or AI credentials in the web Worker.

Use approved account access and secret storage. No `wrangler login`, secret upload, DNS change or paid-resource creation is automatic. Do not commit `.dev.vars`, `.wrangler`, generated bundles or credentials.

Acceptance: sign-in/cookie/CSRF checks; upload→review→all-party approval; cross-tenant rejection; preserved ledger after restart; duplicate/reordered signed PayPal webhook handling; idempotent payout reconciliation. Register the stable public API webhook URL only after routing and signature checks work. A verified isolated webhook receiver is not proof the app ledger reconciles.

## Sources (checked November 10, 2026)

- https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/
- https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- https://developers.cloudflare.com/containers/faq/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
