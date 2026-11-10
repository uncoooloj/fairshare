# Release readiness

## Current status

This repository is private and provides an MIT license for the source. It is not production-ready and has no live-money mode. Historical verification notes describe evidence collected at the time stated; they are not a claim that the same result has been re-run against the current head.

Local tests, typechecking, and builds establish code and build evidence only. The synthetic DEMO confirms no provider operation. A release requires separate runtime evidence for the deployed application and every enabled integration.

## Release gates

Before any public release, establish and record:

1. A clean install, tests, typecheck, and build at the release commit.
2. A deployed browser journey covering authentication, workspace isolation, agreement review, approval, activation, and allocation preview.
3. A sandbox-only PayPal acceptance run that verifies buyer approval, capture and fee reconciliation, signed webhook delivery, refund handling, and exact recipient payout outcomes. Batch acceptance alone is insufficient.
4. Approved operational configuration for persistent SQLite storage, backups and restore, one API writer, HTTPS origins, and server-side secret storage.
5. Authorized email delivery evidence if email is enabled, including sender setup and inbox delivery; DEMO simulation is not delivery evidence.
6. Review of dependency notices and bundled assets. The web app includes Onest font files with their [OFL notice](../apps/web/public/fonts/OFL.txt); third-party terms remain applicable.
7. An owner-approved review of provenance and publication rights for all source, generated assets, demo material, and documentation before public distribution.

Do not describe the project as production-ready, as a legal agreement system, as escrow, or as a live marketplace settlement product until evidence supports those claims. See [JUDGE-DEPLOYMENT.md](JUDGE-DEPLOYMENT.md) for the fuller deployment plan.
