# Fairshare

Fairshare turns a collaboration agreement into reviewable allocation rules. People approve an exact rule version; deterministic code calculates an allocation from confirmed revenue; payout records remain separate from the allocation itself.

The repository is a sandbox-focused implementation. It has no live-money mode, and a checkout return or a payout batch acceptance is not proof that money moved.

## Repository map

| Path                   | Purpose                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/web`             | Next.js web application and same-origin API proxy.                                                             |
| `apps/api`             | Fastify API, identity, workspace isolation, agreement lifecycle, SQLite persistence, and sandbox integrations. |
| `packages/domain`      | Deterministic agreement versions, approvals, allocation, and recoupment.                                       |
| `packages/payments`    | Server-only PayPal sandbox adapter and reconciliation primitives.                                              |
| `packages/contract-ai` | Source-bound, non-executable AI observations and proposal helpers.                                             |
| `docs`                 | Product intent, operational boundaries, and release evidence.                                                  |

## Local demo

Use Node `>=22.16` and npm. The commands below create only a local synthetic DEMO database; they make no PayPal, Cloudflare, or email calls.

```sh
npm ci
node --import tsx scripts/seed-demo.mjs ./data/fairshare-demo.db

export HOST=127.0.0.1
export PORT=3001
export DEMO_MODE=true
export DATABASE_PATH=./data/fairshare-demo.db
export PUBLIC_APP_ORIGIN=http://localhost:3000
export PUBLIC_API_URL=http://localhost:3001
export PAYPAL_ENV=sandbox
npm run dev:api
```

In a second terminal:

```sh
export FAIRSHARE_API_URL=http://127.0.0.1:3001
export FAIRSHARE_WEB_ORIGIN=http://localhost:3000
npm run dev:web
```

Open <http://localhost:3000>. Use one of the synthetic accounts in [the demo guide](docs/DEMO-QUICKSTART.md). The seed script refuses to overwrite an existing database. DEMO and SANDBOX must use different databases.

The API process does not load dotenv files automatically. `apps/api/.env.example` and `apps/web/.env.example` document variable names; use explicit environment exports for the API. Do not put credentials in `NEXT_PUBLIC_*` variables or commit them.

## Checks

```sh
npm run format:check
npm test
npm run typecheck
npm run build
```

These checks provide source-level and build evidence. They do not prove browser behavior, provider delivery, payment completion, payout receipt, or production readiness.

## Evidence boundaries

- DEMO uses synthetic identities, approvals, and an already-recorded advance. They are fixtures, not evidence of real approvals or funds.
- AI observations require human review and cannot activate rules or move money.
- The payment adapter is sandbox-only. Provider acceptance, capture, webhook delivery, refunds, and recipient payout outcomes each need their own evidence.
- The reconciliation worker exists but is disabled by default and performs reads/reconciliation only; it does not issue money-moving retries.
- New PDF and DOCX uploads retain an authenticated original alongside extracted text. That private SQLite data is not encrypted at rest by this application.
- Password recovery needs an authorized email transport; the synthetic DEMO does not provide a reset-link echo.
- Review discussion records comments without changing rules or approvals.
- Checkout payment-source labels are organizer-entered metadata, not evidence of external revenue or a confirmed payment.
- Local scanned-PDF OCR is disabled by default, runs only after a user selects it, and needs host-installed Poppler and Tesseract. It is not a Cloudflare upload or a correctness guarantee.
- Authenticator MFA needs a separately managed server encryption key; it is not enabled by the synthetic DEMO alone.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Demo quickstart](docs/DEMO-QUICKSTART.md)
- [API flows](docs/API-FLOWS.md)
- [Payment flow and boundaries](docs/PAYMENTS.md)
- [Reconciliation worker](docs/RECONCILIATION-WORKER.md)
- [Authentication and persistence](docs/AUTH-PERSISTENCE.md)
- [Source-document storage and downloads](docs/security/source-documents.md)
- [Password recovery](docs/password-recovery.md)
- [Local OCR](docs/LOCAL-OCR.md)
- [Authenticator MFA](docs/mfa.md)
- [Release readiness](docs/RELEASE-READINESS.md)
- [Contributing](CONTRIBUTING.md)

## License

Fairshare is available under the [MIT License](LICENSE). Dependency and bundled-asset notices, including the bundled Onest font's OFL notice, remain subject to their own terms.
