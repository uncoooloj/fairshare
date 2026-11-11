import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgreementIntake } from "../components/agreement-intake";
import { SandboxCheckoutForm } from "../components/sandbox-checkout-form";
import { appSource } from "./app-source";

test("creation starts with one step at a time, and switching upload/paste keeps both drafts", () => {
  const html = renderToStaticMarkup(
    createElement(AgreementIntake, {
      owner: { id: "o", name: "Maya", email: "maya@example.test" },
      onCreate: async () => ({
        workspaceId: "w",
        agreementId: "a",
        documentId: "d",
        documentText: "",
        agreement: {} as never,
      }),
      onFinish: () => {},
      onKeepDraft: () => {},
      onClose: () => {},
      onBusyChange: () => {},
    }),
  );
  assert.match(html, /Upload your agreement/);
  assert.match(html, /type="file"/);
  assert.doesNotMatch(html, /<textarea/);
  const source = readFileSync(
    new URL("../components/wizard-intake.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(mode === DocumentMode.UPLOAD\)/);
  const wizard = readFileSync(
    new URL("../components/agreement-creation-wizard.tsx", import.meta.url),
    "utf8",
  );
  // Switching upload/paste keeps both; only "Upload a different file" starts clean.
  const switching = wizard.slice(
    wizard.indexOf("const setMode = "),
    wizard.indexOf("function documentProblem()"),
  );
  assert.ok(switching.length > 0);
  assert.doesNotMatch(switching, /setFileState\(null\)|setTextState\(""\)/);
});

test("checkout starts with details and does not expose final action before review", () => {
  const html = renderToStaticMarkup(
    createElement(SandboxCheckoutForm, {
      busy: false,
      onSubmit: async () => {},
    }),
  );
  assert.match(html, /Review checkout/);
  assert.doesNotMatch(html, /Create sandbox checkout|Edit checkout details/);
  assert.match(html, /Every checkout here still uses PayPal sandbox/);
});

test("checkout review validates without API calls, retains edits, moves focus and leaves errors visible", () => {
  const source = readFileSync(
    new URL("../components/sandbox-checkout-form.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /parseCents\(amount\)/);
  assert.match(
    source,
    /if\s*\(!reviewing\)\s*\{\s*setReviewing\(true\);\s*return;\s*\}/,
  );
  const reviewGuard = source.indexOf("if (!reviewing)");
  const submit = source.indexOf("await onSubmit");
  assert.ok(reviewGuard >= 0);
  assert.ok(submit >= 0);
  assert.ok(reviewGuard < submit);
  assert.match(source, /target\?\.focus\(\)/);
  assert.match(source, /Edit checkout details/);
  assert.match(source, /role="alert"/);
  assert.match(source, /busy\s*\|\|\s*pending\.current/);
  assert.doesNotMatch(source, /setAmount\(''\)|setSourceName\(''\)/);
});

test("checkout review enforces API amount bounds and resets per agreement", () => {
  const source = readFileSync(
    new URL("../components/sandbox-checkout-form.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /cents\s*<\s*1\s*\|\|\s*cents\s*>\s*1_000_000/);
  const app = appSource();
  assert.match(app, /<AgreementInvoices\s+key=\{selected\.id\}/);
});
