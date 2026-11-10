import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareAuthForm } from "../lib/auth-form";
test("auth trims identity fields but preserves password exactly", () => {
  const result = prepareAuthForm(false, {
    name: " Maya ",
    email: " maya@example.com ",
    password: "  secret with spaces  ",
  });
  assert.deepEqual(result, {
    data: {
      name: "Maya",
      email: "maya@example.com",
      password: "  secret with spaces  ",
    },
    error: "",
  });
});
test("whitespace-only registration name is rejected; login needs no name", () => {
  assert.equal(
    prepareAuthForm(false, {
      name: "  ",
      email: "a@b.com",
      password: "abcdefghijkl",
    }).error,
    "Enter your full name.",
  );
  assert.equal(
    prepareAuthForm(true, { email: "a@b.com", password: "x" }).error,
    "",
  );
});
test("auth enforces API length limits without truncating password", () => {
  assert.match(
    prepareAuthForm(true, { email: "a".repeat(255), password: "x" }).error,
    /email/,
  );
  assert.match(
    prepareAuthForm(true, { email: "a@b.com", password: "x".repeat(257) })
      .error,
    /password/,
  );
  assert.equal(
    prepareAuthForm(true, { email: "a@b.com", password: "x".repeat(256) })
      .error,
    "",
  );
});
test("onboarding matches API workspace limit; auth mode switch dismisses stale errors and masks password", () => {
  const source = readFileSync(
    new URL("../components/designer-auth.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("maxLength={100}"));
  assert.match(
    source,
    /setShowServerError\(false\);\s*setShowPassword\(false\)/,
  );
  assert.ok(source.includes("aria-pressed={showPassword}"));
});
