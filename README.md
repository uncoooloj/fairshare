# Fairshare

The money follows the agreement.

Private development monorepo for agreement-driven revenue allocation. Web design is owned by the product designer; the web application here is a neutral integration shell, not the approved dashboard.

## Structure

- `apps/web`: Next.js web client.
- `apps/api`: separate Node/Fastify API (being integrated).
- `packages/domain`: deterministic agreement versions, approvals and allocation.
- `packages/payments`: sandbox-only PayPal provider and webhook processing primitives.
- `packages/contract-ai`: source-bound AI proposals, not legal advice or payment authority.

## Development

Node 22.16+ and npm are required. Run `npm ci`, `npm test`, `npm run typecheck`, then `npm run dev:web`. Web runs locally at http://localhost:3000. No secret belongs in a NEXT_PUBLIC variable. Copy backend environment templates only locally; never commit credentials or a runtime database.

## Honest status

This foundation is not a complete product. Package tests are not proof of actual provider operations. Only PayPal sandbox OAuth has previously been verified in the Kept prototype; Fairshare checkout, capture, payout, refunds and webhooks require their own evidence. No live money is enabled.

Rules require all required collaborators to approve the same version before activation. AI proposes; deterministic code calculates; allocation and completed payout are separate facts. Refunds/reversals require reconciliation, not guessed clawbacks. No claim of escrow, legal enforcement or live partner eligibility.

## Reuse

Selected PayPal safety patterns derive from the user's private Kept prototype (`uncoooloj/paypal-hackathon`). No secret, data file, mobile app or unrelated asset was copied. Dependencies retain their upstream licences; project licence/public release remains an owner decision.
