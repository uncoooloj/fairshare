# Cloudflare API runtime

Hosted sandbox verification is recorded in `docs/CLOUDFLARE.md`; current checkpoint
redeployment remains explicit. The optional Worker forwards every request to one SQLite-backed
`FairshareAuthority` Durable Object. Identity, agreement, payment and webhook
tables stay in one atomic SQL authority; do not shard workspaces without a global
capture-reservation design.

Existing API business handlers are reused. A narrow no-eval router replaces
Fastify's runtime-generated router only in the Worker bundle. Unsupported
validation keywords fail at startup instead of silently weakening validation. Node
API remains Fastify and continues to own its local database.

- `npm run build:cloudflare -w @fairshare/api`: build the Worker (esbuild).
- `npm run check:cloudflare -w @fairshare/api`: typecheck, build, then run the local workerd flow and full restart persistence check.
- `npm test -w @fairshare/api`: Node API and router/parser regression checks.

The local workerd smoke passes: it covers auth, validation, tenant isolation,
atomic text intake and retry, source-bound proposals, approval/activation, stale
revision rejection and persistent sessions/agreements. Mocked outbound PayPal
verifies create/capture, net-of-fees allocation and duplicate retry safety.
**This is not real PayPal evidence.** No test uses merchant credentials or sends
real provider requests.

Provider and AI secrets are environment bindings, never client bundles. PayPal is
sandbox-only. Reconciliation uses opt-in Durable Object alarms and existing fenced
leases; no process polling loop is started. The authority creates an alarm only
when a configured provider exists and `PAYPAL_RECONCILIATION_ENABLED=true`.
A private `DOCUMENT_PARSER` binding is required for PDF/DOCX. With
`OCR_ENABLED=true`, the parser reads native PDF text first and automatically tries
scan reading once only when the PDF has no extractable text; there is no per-upload
OCR consent control. Limits, parser failures and timeouts do not fall back. This
document-reading path is separate from the explicit per-extraction consent that
sends agreement text to Cloudflare AI for rule suggestions. Missing parser fails
with 503 without partial intake writes. See `../parser-container/README.md`.

Toolchain versions are pinned in the API package; `npm run check:cloudflare -w
@fairshare/api` checks Worker types and local runtime. `wrangler deploy --dry-run --containers-rollout=none` validates
the Worker and both DO bindings without uploading; it does not build the Docker
image. The manifest leaves public routes and all optional money/OCR flags off.
The parser has one maximum instance, one-minute idle sleep and internet disabled.

Before deploying: build and test the parser Container, configure the HTTPS API
route or service binding, secrets and durable resources, confirm current storage
limits, test alarm recovery and signed PayPal sandbox webhooks against the
deployed database, and prepare backup/migration/rollback. Existing local SQLite
data is not migrated by this scaffold.
