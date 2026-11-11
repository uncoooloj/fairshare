import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { GET, PUT, POST } from "../app/api/service/[...path]/route";
test("five settings sections mount real components and protect workspace-less account setup", () => {
  const source = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  for (const label of [
    "Profile",
    "Payment accounts",
    "Notifications",
    "Currency & display",
    "Activity log",
  ])
    assert(source.includes(`"${label}"`));
  for (const component of [
    "ProfileContact",
    "PaymentAccountsSettings",
    "NotificationsSettings",
    "CurrencyDisplaySettings",
    "ActivityLogSettings",
  ])
    assert(source.includes(`<${component}`));
  assert.match(source, /workspace\s*\?\s*\(\s*<>/);
  assert(source.includes('settingsTab === "Profile"'));
});
test("BFF reaches authenticated settings activity preserving filters", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/api/settings/activity");
      assert.equal(url.searchParams.get("days"), "7");
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer test-session",
      );
      return Response.json({ events: [] });
    };
    const response = await GET(
      new NextRequest("http://localhost/api/service/settings/activity?days=7", {
        headers: { cookie: "fairshare_session=test-session" },
      }),
      { params: Promise.resolve({ path: ["settings", "activity"] }) },
    );
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = previous;
  }
});

test("BFF allows bounded profile photos and clears session after confirmed email change", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ ok: true });
    const headers = {
      origin: "http://localhost",
      "content-type": "application/json",
      cookie: "fairshare_session=test-session",
    };
    const photo = await PUT(
      new NextRequest("http://localhost/api/service/auth/profile/photo", {
        method: "PUT",
        headers,
        body: JSON.stringify({ photo: "x".repeat(120000) }),
      }),
      { params: Promise.resolve({ path: ["auth", "profile", "photo"] }) },
    );
    assert.equal(photo.status, 200);
    const change = await POST(
      new NextRequest(
        "http://localhost/api/service/auth/email-change/confirm",
        { method: "POST", headers, body: JSON.stringify({ token: "test" }) },
      ),
      {
        params: Promise.resolve({ path: ["auth", "email-change", "confirm"] }),
      },
    );
    assert.equal(change.status, 200);
    assert.match(change.headers.get("set-cookie") ?? "", /fairshare_session=;/);
  } finally {
    globalThis.fetch = previous;
  }
});
