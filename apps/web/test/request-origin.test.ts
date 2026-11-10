import test from "node:test";
import assert from "node:assert/strict";
import { acceptsRequestOrigin } from "../lib/request-origin";
test("custom and retained Workers origins only allow same-host requests", () => {
  const origins = [
    "https://usefairshare.app",
    "https://fairshare-web.udaleamehoj.workers.dev",
  ];
  for (const origin of origins)
    assert.equal(
      acceptsRequestOrigin(origin, new URL(origin).host, origins),
      true,
    );
  assert.equal(
    acceptsRequestOrigin(origins[0], new URL(origins[1]).host, origins),
    false,
  );
  for (const origin of [
    "https://evil.usefairshare.app",
    "https://usefairshare.app.evil.test",
    "http://usefairshare.app",
    "null",
  ])
    assert.equal(
      acceptsRequestOrigin(origin, "usefairshare.app", origins),
      false,
    );
  assert.equal(acceptsRequestOrigin(null, "usefairshare.app", origins), false);
});
