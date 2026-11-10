# Release readiness

## Current status

This repository is private and provides an MIT license for the source. It is not production-ready and has no live-money mode. Historical verification notes describe evidence collected at the time stated; they are not a claim that the same result has been re-run against the current head.

Local tests, typechecking, and builds establish code and build evidence only. The synthetic DEMO confirms no provider operation.

The [Cloudflare deployment](CLOUDFLARE.md) notes and [Durable SQL prototype](../packages/cloudflare-storage/README.md) describe an adapter/prototype seam only. They do not establish a wired API, a deployed Worker, or durable acceptance.

## Source publication gates

Before publishing the source, establish and record:

1. A clean install, tests, typecheck, and build at the release commit.
2. An owner-approved review of provenance and publication rights for source, generated assets, demo material, and documentation.
3. A dependency-notice and bundled-asset review. The web app includes Onest font files with their [OFL notice](../apps/web/public/fonts/OFL.txt); third-party terms remain applicable.
4. A review of repository history and release artifacts for secrets, credentials, personal data, raw agreements, invitation tokens, and provider payloads.
5. Documentation of the sandbox-only, non-production limitations and the distinction between synthetic demo data and provider evidence.
6. Documentation of document-retention boundaries: new PDF/DOCX originals are stored in private SQLite data, while legacy/text-only uploads have no original to download.

## Deployment and integration acceptance

Before describing a deployment or enabled integration as ready, establish and record:

1. A deployed browser journey covering authentication, workspace isolation, agreement review, approval, activation, and allocation preview.
2. A sandbox-only PayPal acceptance run that verifies buyer approval, capture and fee reconciliation, signed webhook delivery, refund handling, and exact recipient payout outcomes. Batch acceptance alone is insufficient.
3. Approved operational configuration for persistent SQLite storage, backups and restore, one API writer, HTTPS origins, and server-side secret storage.
4. Authorized email delivery evidence if email is enabled, including sender setup and inbox delivery; DEMO simulation is not delivery evidence.
5. Password-reset acceptance with an authorized, real mailbox when that feature is enabled.
6. If local OCR is enabled, a host acceptance run for its installed Poppler/Tesseract tools, protected temporary storage and cleanup, bounded resources, and the user opt-in path.
7. If MFA is enabled, durable, access-controlled backup and recovery handling for `FAIRSHARE_MFA_ENCRYPTION_KEY`, plus a real authenticator-app walkthrough.

A public source release can proceed after the source publication gates. Deployment and integration evidence is separate. See [JUDGE-DEPLOYMENT.md](JUDGE-DEPLOYMENT.md) for the fuller deployment plan.
