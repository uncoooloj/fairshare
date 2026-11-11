import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

test("a bodiless DELETE is forwarded without a JSON content type; a POST keeps it", async () => {
  process.env.FAIRSHARE_API_URL = "http://api.test";
  const { DELETE, POST } = await import("../app/api/service/[...path]/route");
  const seen: { method: string; headers: Headers; body: unknown }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push({
      method: String(init.method),
      headers: new Headers(init.headers),
      body: init.body,
    });
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const call = (handler: typeof DELETE, method: string, body?: string) =>
    handler(
      new NextRequest(
        "http://app.test/api/service/workspaces/w/collaborations/a?expectedRevision=2",
        {
          method,
          body,
          headers: { origin: "http://app.test", host: "app.test" },
        },
      ),
      {
        params: Promise.resolve({
          path: ["workspaces", "w", "collaborations", "a"],
        }),
      },
    );
  try {
    assert.equal((await call(DELETE, "DELETE")).status, 200);
    assert.equal(
      (await call(POST, "POST", '{"expectedRevision":2}')).status,
      200,
    );
    // The origin check still runs first.
    const foreign = await DELETE(
      new NextRequest("http://app.test/api/service/workspaces/w", {
        method: "DELETE",
        headers: { origin: "http://evil.test", host: "app.test" },
      }),
      { params: Promise.resolve({ path: ["workspaces", "w"] }) },
    );
    assert.equal(foreign.status, 403);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(seen.length, 2);
  assert.equal(seen[0].method, "DELETE");
  assert.equal(seen[0].headers.get("content-type"), null);
  assert.equal(seen[1].headers.get("content-type"), "application/json");
});
