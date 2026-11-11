import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const config = JSON.parse(
  readFileSync(new URL("../../apps/api/wrangler.hosted.json", import.meta.url)),
);
test("hosted configuration preserves sandbox authority and parser", () => {
  assert.equal(config.name, "fairshare-api-sandbox");
  assert.equal(config.keep_vars, true);
  assert.equal(config.vars.PUBLIC_APP_ORIGIN, "https://usefairshare.app");
  assert.match(config.vars.PUBLIC_API_URL, /fairshare-api-sandbox/);
  assert.equal(config.containers[0].max_instances, 1);
  assert.match(config.containers[0].image, /@sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    config.durable_objects.bindings.map((x) => x.class_name),
    ["FairshareAuthority", "FairshareDocumentParser"],
  );
  for (const key of [
    "PAYPAL_PAYOUTS_ENABLED",
    "PAYPAL_PAYOUTS_ELIGIBILITY_CONFIRMED",
    "PAYPAL_RECONCILIATION_ENABLED",
    "PAYPAL_AUTOMATIC_PAYOUTS_ENABLED",
  ])
    assert.equal(config.vars[key], "true");
});
