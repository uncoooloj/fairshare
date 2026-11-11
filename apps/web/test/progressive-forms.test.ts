import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgreementIntake } from "../components/agreement-intake";
import { SandboxCheckoutForm } from "../components/sandbox-checkout-form";
import { appSource } from "./app-source";

test("intake starts with one input method, with paste available without losing either draft", () => {
  const html = renderToStaticMarkup(
    createElement(AgreementIntake, { busy: false, onCreate: async () => {} }),
  );
  assert.match(html, /Upload document/);
  assert.match(html, /Paste text/);
  assert.match(html, /<div hidden=""><label[^>]*>[\s\S]*?Paste agreement text/);
  const source = readFileSync(
    new URL("../components/agreement-intake.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(method === "upload" && file\)/);
  assert.match(source, /method === "upload" \? !file : !text.trim\(\)/);
  assert.doesNotMatch(source, /setFile\(null\)|setText\(""\)/);
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
