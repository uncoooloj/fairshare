# Isolated synthetic demo

This creates three synthetic accounts and one approved sample agreement. It does **not** create payments, payouts, email or AI calls. Approvals and the previously paid advance are fixtures, not evidence of real people approving or funds moving.

From the repository root:

```sh
npm ci
node --import tsx scripts/seed-demo.mjs ./data/fairshare-demo.db
```

The script refuses to overwrite an existing database. Use a new path to create another isolated dataset.

Start the API in DEMO mode using the generated database path, and point the Next web app at that API using the repository's example environment files. Do not reuse this database in SANDBOX mode.

Sign in as `maya@fairshare.example`, `jordan@fairshare.example`, or `riley@fairshare.example`, password `FairshareDemo123!`.

The agreement preview uses $3,000 eligible revenue: Maya recoups $2,000 then receives $500, Jordan $300, Riley $200. No revenue has actually been received in this dataset. Use the preview, source, terms and people views to inspect the deterministic agreement flow. PayPal acceptance remains a separate test.
