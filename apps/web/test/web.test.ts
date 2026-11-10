import test from "node:test";
import assert from "node:assert/strict";
import { parseCents, parseShare, money } from "../lib/model";
import { POST, GET } from "../app/api/service/[...path]/route";
import { NextRequest } from "next/server";
import { createServer } from "node:http";
test("money input preserves cents and rejects non-decimal/unsafe values", () => {
  assert.equal(parseCents("3000.01"), 300001);
  assert.equal(parseCents("0.1"), 10);
  assert.equal(parseShare("33.33"), 3333);
  assert.equal(money(300), "$3.00");
  for (const v of ["1.001", "-5", "NaN", "1e3", "900000000000000"])
    assert.throws(() => parseCents(v));
  assert.throws(() => parseShare("100.01"));
});
test("same-origin BFF protects session, rejects cross-origin writes and unsupported paths", async () => {
  const original = process.env.FAIRSHARE_API_URL;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/auth/login")
      res.end(
        JSON.stringify({
          user: { id: "u", name: "Maya" },
          token: "server-only-token",
        }),
      );
    else if (req.url === "/api/agreements/intake") {
      req.resume();
      res.end(JSON.stringify({ authorized: req.headers.authorization, accepted: true }));
    }
    else if (req.url === "/api/auth/me")
      res.end(JSON.stringify({ authorized: req.headers.authorization }));
    else {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: "Sign in" } }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as any;
  process.env.FAIRSHARE_API_URL = `http://127.0.0.1:${address.port}`;
  try {
    const ctx = { params: Promise.resolve({ path: ["auth", "login"] }) };
    const bad = await POST(
      new NextRequest("http://localhost/api/service/auth/login", {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: "{}",
      }),
      ctx,
    );
    assert.equal(bad.status, 403);
    const good = await POST(
      new NextRequest("http://localhost/api/service/auth/login", {
        method: "POST",
        headers: { origin: "http://localhost" },
        body: "{}",
      }),
      ctx,
    );
    assert.equal(good.status, 200);
    assert.equal((await good.json()).token, undefined);
    assert.match(good.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(good.headers.get("set-cookie")!, /SameSite=strict/i);
    const me = await GET(
      new NextRequest("http://localhost/api/service/auth/me", {
        headers: { cookie: "fairshare_session=server-only-token" },
      }),
      { params: Promise.resolve({ path: ["auth", "me"] }) },
    );
    assert.equal((await me.json()).authorized, "Bearer server-only-token");
    const intake = await POST(new NextRequest("http://localhost/api/service/agreements/intake", {
      method: "POST", headers: {origin: "http://localhost", cookie: "fairshare_session=server-only-token"},
      body: JSON.stringify({base64: "a".repeat(120000)}),
    }), {params: Promise.resolve({path: ["agreements", "intake"]})});
    assert.equal(intake.status, 200);
    assert.equal((await intake.json()).authorized, "Bearer server-only-token");
    const oversized = await POST(new NextRequest("http://localhost/api/service/agreements/intake", {
      method: "POST", headers: {origin: "http://localhost"}, body: "a".repeat(7 * 1024 * 1024 + 1),
    }), {params: Promise.resolve({path: ["agreements", "intake"]})});
    assert.equal(oversized.status, 413);
    const unknown = await GET(
      new NextRequest("http://localhost/api/service/evil"),
      { params: Promise.resolve({ path: ["evil"] }) },
    );
    assert.equal(unknown.status, 404);
    const traversal = await GET(
      new NextRequest("http://localhost/api/service/auth"),
      { params: Promise.resolve({ path: ["auth", ".."] }) },
    );
    assert.equal(traversal.status, 400);
  } finally {
    server.close();
    process.env.FAIRSHARE_API_URL = original;
  }
});
