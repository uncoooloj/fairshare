import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
test("Cloudflare manifest provisions durable SQL authority and private bounded parser, never enables money features by default", () => {
  const config = JSON.parse(read("../wrangler.jsonc"));
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.migrations[0].new_sqlite_classes, [
    "FairshareAuthority",
    "FairshareDocumentParser",
  ]);
  assert.equal(config.containers.length, 1);
  assert.equal(config.containers[0].max_instances, 1);
  assert.equal(config.containers[0].image_build_context, "../..");
  for (const key of [
    "HACKATHON_MFA_SIMULATION",
    "PAYPAL_PAYOUTS_ENABLED",
    "PAYPAL_PAYOUTS_ELIGIBILITY_CONFIRMED",
    "PAYPAL_RECONCILIATION_ENABLED",
  ])
    assert.equal(config.vars[key], "false");
  assert.equal(config.vars.OCR_ENABLED, "true");
  assert.equal(new URL(config.vars.PUBLIC_API_URL).protocol, "https:");
  assert.equal(new URL(config.vars.PUBLIC_APP_ORIGIN).protocol, "https:");
  assert.equal(config.limits.cpu_ms, 3000);
  assert.equal(
    Object.keys(config.vars).some((key) =>
      /SECRET|TOKEN|ENCRYPTION_KEY/.test(key),
    ),
    false,
  );
  assert.match(read("../cloudflare/parser.ts"), /enableInternet = false/);
  assert.match(read("../../../.dockerignore"), /\*\*\/\.env\*/);
});
