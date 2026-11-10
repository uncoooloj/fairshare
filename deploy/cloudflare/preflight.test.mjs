import test from "node:test";
import assert from "node:assert/strict";
import { validateCloudflareEnvironment as validate } from "./preflight.mjs";
const valid = {
  FAIRSHARE_API_URL: "https://api.fairshare.example",
  FAIRSHARE_WEB_ORIGIN: "https://fairshare.example",
  FAIRSHARE_API_PERSISTENCE_VERIFIED: "true",
};
test("requires explicit persistent API acknowledgement", () => {
  assert.equal(
    validate({ ...valid, FAIRSHARE_API_PERSISTENCE_VERIFIED: "" }).length,
    1,
  );
});
test("valid HTTPS deployment origins pass only the configuration gate", () => {
  assert.deepEqual(validate(valid), []);
});
test("rejects localhost, quick tunnels, credentials and URL paths without echoing secrets", () => {
  for (const origin of [
    "http://localhost:3111",
    "https://127.0.0.1",
    "https://[::1]",
    "https://temporary.trycloudflare.com",
    "https://secret:password@api.example",
    "https://api.example/path",
    "https://api.example?token=secret",
  ]) {
    const errors = validate({ ...valid, FAIRSHARE_API_URL: origin });
    assert.equal(errors.length, 1);
    assert.ok(!errors[0].includes("password"));
  }
});
