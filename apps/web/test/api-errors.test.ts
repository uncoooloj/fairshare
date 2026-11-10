import test from "node:test";
import assert from "node:assert/strict";
import { api, ApiError } from "../lib/model";
import { readFileSync } from "node:fs";
test("API retains structured revision conflict without retrying writes", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({
        error: { code: "REVISION_CONFLICT", message: "Reload latest" },
      }),
      { status: 409 },
    );
  };
  try {
    await assert.rejects(
      api("agreements/1", "POST", {}),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === "REVISION_CONFLICT" &&
        error.status === 409,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("mutation recovery fetches current state and requires fresh user decision", () => {
  const source = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /cause.code === "REVISION_CONFLICT"/);
  assert.match(source, /const current = await api<Agreement>\(base\)/);
  assert.match(source, /Latest version loaded; review before trying again/);
  assert.match(
    source,
    /setSource\(sampleAgreement\);\s*setDocumentId\(""\);\s*setExtraction\(null\)/,
  );
});
