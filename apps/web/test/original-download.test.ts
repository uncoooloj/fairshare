import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET } from "../app/api/service/[...path]/route";
const path = [
  "workspaces",
  "w",
  "collaborations",
  "c",
  "documents",
  "d",
  "original",
];
test("BFF serves original only as a bounded private attachment and forwards session server-side", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer private-session",
      );
      return new Response("%PDF-example", {
        headers: { "content-type": "application/pdf" },
      });
    };
    const response = await GET(
      new NextRequest("http://localhost/api/service/" + path.join("/"), {
        headers: { cookie: "fairshare_session=private-session" },
      }),
      { params: Promise.resolve({ path }) },
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "%PDF-example");
    assert.match(response.headers.get("content-disposition")!, /^attachment;/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("authorization"), null);
  } finally {
    globalThis.fetch = previous;
  }
});
test("BFF rejects an unexpected executable original MIME", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("<script>alert(1)</script>", {
        headers: { "content-type": "text/html" },
      });
    const r = await GET(
      new NextRequest("http://localhost/api/service/" + path.join("/")),
      { params: Promise.resolve({ path }) },
    );
    assert.equal(r.status, 502);
    assert.doesNotMatch(await r.text(), /<script>/);
  } finally {
    globalThis.fetch = previous;
  }
});

test("BFF preserves pagination query on the fixed API destination", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("after"), "100");
      assert.equal(
        url.pathname,
        "/api/workspaces/w/collaborations/c/versions/1/comments",
      );
      return Response.json({ comments: [], nextCursor: null });
    };
    const path = [
      "workspaces",
      "w",
      "collaborations",
      "c",
      "versions",
      "1",
      "comments",
    ];
    const r = await GET(
      new NextRequest(
        "http://localhost/api/service/" + path.join("/") + "?after=100",
      ),
      { params: Promise.resolve({ path }) },
    );
    assert.equal(r.status, 200);
  } finally {
    globalThis.fetch = previous;
  }
});

test("BFF rejects redirects without forwarding the session to another destination", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      calls++;
      assert.equal(init?.redirect, "manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://untrusted.example" },
      });
    };
    const response = await GET(
      new NextRequest("http://localhost/api/service/health", {
        headers: { cookie: "fairshare_session=private-session" },
      }),
      { params: Promise.resolve({ path: ["health"] }) },
    );
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
    assert.doesNotMatch(
      await response.text(),
      /private-session|untrusted.example/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});
