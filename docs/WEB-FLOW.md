# Web flow milestone

Next.js dashboard uses the approved Fairshare agreement-centered information architecture:
Overview, Agreements, Payouts, Settings. Terms, People and Payments are within an agreement.

## Run

Start API with a separate DEMO database and `PUBLIC_APP_ORIGIN=http://localhost:3000`.
Run the web app with `FAIRSHARE_API_URL=http://127.0.0.1:3001 npm run dev -w @fairshare/web`.
Only the server-side BFF reads the API origin. In production configure `FAIRSHARE_WEB_ORIGIN`
to the exact external HTTPS origin for origin enforcement. Never use a live PayPal environment.

## Components and tokens

`app/tokens.css` is the single source for color, typography, spacing, radii and layout tokens.
`components/ui.tsx` holds primitives. `agreement-widgets.tsx` holds reusable forms/tables.
`fairshare-app.tsx` coordinates server actions and state; AG Grid is a read-only payout projection.
The final Figma can change tokens and components without changing the money engine.
Onest is the preferred font stack. The application bundles local Onest font assets under the SIL Open Font License; see `public/fonts/OFL.txt`.

## Working routes

Account/register/login/logout, password recovery, workspace setup and selection, invite acceptance and email verification,
upload-first agreement intake (which creates a first workspace when needed), people/invitations, text/PDF/DOCX upload and extracted-text review, authenticated original
downloads, review discussion, opt-in local OCR, opt-in Cloudflare suggestions, conditional authenticator MFA, manual source-bound proposal editing, neutral fee policy choices, exact version approval,
preview, activation, incoming-payment status and traceable allocation breakdown, sandbox checkout,
fixed allocation dispatch and item reconciliation, read-only Community payout grid and account settings.

## Safety and product boundaries

- Session token is stripped from auth responses and held in HttpOnly SameSite=Strict cookies.
  Mutations require same-origin requests; no arbitrary backend URL, credentials or headers are forwarded.
- Payment status is provider-derived. No fabricated completed payouts or sample metrics in authenticated views.
- The dispatch button is a sandbox technical step, not discretionary approval of shares. Automatic scheduling
  is not yet implemented. Unknown request outcomes retain request keys; status must be reconciled.
- PDF and DOCX text must be reviewed. New PDF/DOCX originals are private authenticated downloads; legacy/text-only uploads have no original. Local OCR is off by default and only runs after an explicit user choice.
- AI observations are displayed with source quotations; reviewed human rules are entered explicitly.
  Semantic correctness of clauses requires human review. No automatic legal signature.
- A first agreement starts from its source, not an empty name form. The API saves its workspace, agreement and source together; an uncertain request can be retried with the same request ID. Filename-derived names are suggestions only and can be changed after creation.
- Manual invitation token and email verification links are supported. Sandbox delivery requires configured
  transport; DEMO links are explicitly simulated. No claim of delivered email from accepted requests.
- UI role errors remain authoritative on server. Real-money mode is absent.

## Historical verification notes

At the time recorded, the production Next build and TypeScript passed. Five focused web tests covered exact cents, grid validation and
BFF session/CSRF/path restrictions. An actual production-server HTTP journey passed registration→workspace→
agreement→source→proposal→send→approve→activate→preview→payment/payout reads→logout against the real API.
No provider call was made in that journey. Browser visual QA was attempted but Chromium could not open
its process socket in the cloud sandbox. Native/desktop browser verification remains outstanding.
