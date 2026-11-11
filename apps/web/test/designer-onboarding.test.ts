import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/designer-auth.tsx", import.meta.url),
  "utf8",
);

test("designer auth retains real login/register payloads and registration password policy", () => {
  assert.ok(
    source.includes('onSubmit(login ? "login" : "register", prepared.data)'),
  );
  for (const name of ["email", "password", "name"])
    assert.ok(source.includes(`name="${name}"`));
  assert.ok(source.includes("minLength={login ? 1 : 12}"));
  assert.ok(source.includes("if (busy) return;"));
  assert.ok(source.includes('role="alert"'));
});
test("onboarding never claims provider success or adds unsupported OAuth links", () => {
  assert.doesNotMatch(source, /Example: \$3,000 payment/);
  assert.match(
    source,
    /the\s+organizer\s+adds\s+you\s+to\s+the\s+agreement\s+so\s+you\s+can\s+approve\s+the\s+split\./,
  );
  assert.doesNotMatch(source, /WorkspaceOnboarding|Workspace name/);
  assert.match(source, /if\s*\(\s*!busy\s*\)\s*onContinue\(\s*\)/);
  assert.doesNotMatch(
    source,
    /href=.*(?:google|microsoft)|setTimeout|localStorage|Payment successful|Email verified/,
  );
});

test("email-token verification keeps its existing API contract on the standalone auth canvas", () => {
  const app = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(app, /flowToken && flowKind === "\/verify-email"/);
  assert.match(app, /<AccessPrompt\s+standalone\s+kind="verification"/);
  assert.match(
    app,
    /api\("auth\/verification\/confirm", "POST", \{\s+token: flowToken,/,
  );
});

test("standalone verification renders a failed confirmation and keeps retry or cancel available", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { AuthErrorNotice } = await import("../components/auth-error-notice");
  const html = renderToStaticMarkup(
    createElement(AuthErrorNotice, {
      className: "error",
      message: "This verification link has expired.",
    }),
  );
  assert.match(html, /role="alert"[^>]*>This verification link has expired\./);
  assert.equal(
    renderToStaticMarkup(createElement(AuthErrorNotice, { message: "" })),
    "",
  );
  assert.match(
    source,
    /AuthErrorNotice className=\{styles\.error\} message=\{error\}/,
  );
  assert.match(source, /Back to Fairshare/);
});
