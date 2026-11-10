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

Account/register/login/logout, capability-gated password-reset and verification request controls with confirmation routes retained, workspace setup and selection, private-link invite acceptance,
upload-first agreement intake (which creates a first workspace when needed), people/invitations, text/PDF/DOCX upload and extracted-text review, authenticated original
downloads, review discussion, opt-in local OCR, opt-in Cloudflare suggestions, conditional authenticator MFA, manual source-bound proposal editing, neutral fee policy choices, exact version approval,
preview, activation, incoming-payment status and traceable allocation breakdown, sandbox checkout,
fixed allocation dispatch and item reconciliation, copied review reminders, read-only Community payout grid and account settings.

Settings includes display preferences, a filtered read-only activity log, profile safeguards and workspace-scoped sandbox payout destinations. A saved destination is masked to collaborators and remains unverified; server payment credentials are managed by the deployment owner, not through the screen.

## Safety and product boundaries

- Session token is stripped from auth responses and held in HttpOnly SameSite=Strict cookies.
  Mutations require same-origin requests; no arbitrary backend URL, credentials or headers are forwarded.
- Payment status is provider-derived. No fabricated completed payouts or sample metrics in authenticated views.
- The dispatch button is a sandbox technical step, not discretionary approval of shares. Automatic scheduling
  is not yet implemented. Unknown request outcomes retain request keys; status must be reconciled.
- PDF and DOCX text must be reviewed. New PDF/DOCX originals are private authenticated downloads; legacy/text-only uploads have no original. Local OCR is off by default and only runs after an explicit user choice.
- AI observations are displayed with source quotations; reviewed human rules are entered explicitly.
  Semantic correctness of clauses requires human review. No automatic legal signature.
- A first agreement starts from its source, not an empty name form. The API saves its workspace, agreement and source together; an uncertain request can be retried with the same request ID. A filename, or a safe short pasted document heading, can supply the initial name without an AI request; unsafe text falls back to **Untitled agreement**. Names can be changed after creation.
- Terms preparation is progressive: choose the source, read the saved agreement and then prepare proposed rules. The third step stays unavailable until the saved source has been read. Moving between steps preserves the rules draft. If saving an edited source fails, keep that edited source available for retry; it neither replaces nor deletes the previously committed document, and the flow does not advance. Continuing through this flow does not approve or activate a version.
- The workspace-name editor starts with the server name. Later refreshes replace an untouched draft, but never overwrite a locally edited unsaved name; after a matching save, it returns to the server value. A failed rename keeps the draft for retry.
- Private invitation links are the primary collaboration flow and review reminders are copied for direct sharing; neither sends email. `GET /api/auth/capabilities` gates the current UI's email request controls for forgotten-password, verification-request, and email-change flows. Confirmation routes and their existing token/authentication rules remain registered, including the reset-confirm form. The web UI does not expose legacy email-invitation creation; that configured backend route remains separate. Sandbox delivery still requires configured transport; DEMO links are explicitly simulated. No claim of delivered email follows provider acceptance.
- For a first proposal, the person saving it must acknowledge the displayed agreement roster before saving. This is a UI check that all share/approval participants were added before membership locks; accepting a workspace invitation alone does not add a person to the agreement or permit their review.
- UI role errors remain authoritative on server. Real-money mode is absent.

## Historical verification notes

At the time recorded, the production Next build and TypeScript passed. Five focused web tests covered exact cents, grid validation and
BFF session/CSRF/path restrictions. An actual production-server HTTP journey passed registration→workspace→
agreement→source→proposal→send→approve→activate→preview→payment/payout reads→logout against the real API.
No provider call was made in that journey. Browser visual QA was attempted but Chromium could not open
its process socket in the cloud sandbox. Native/desktop browser verification remains outstanding.
