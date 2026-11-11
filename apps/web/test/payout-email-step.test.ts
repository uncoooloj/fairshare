import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PayoutEmailStep,
  PayoutReadiness,
  normalizePayoutEmail,
  payoutReadinessLabel,
  unclaimedPayoutLabel,
} from "../components/payout-email-step";

const source = (file: string) =>
  readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("payout email step uses plain copy and an email field", () => {
  const html = renderToStaticMarkup(
    createElement(PayoutEmailStep, { onDone: () => {} }),
  );
  assert.match(html, /Where should we send your share\?/);
  assert.match(
    html,
    /Enter the email you use for PayPal\. If you don’t have PayPal yet, they’ll email you a link to claim it\./,
  );
  assert.match(html, /type="email"/);
  assert.match(html, /autoComplete="email"|autocomplete="email"/);
  assert.match(html, />Save</);
  assert.match(html, />Do this later</);
  assert.doesNotMatch(html, /merchant|13|sandbox/i);
});

test("payout email validation trims and lowercases", () => {
  assert.equal(normalizePayoutEmail(" Maya@Example.COM "), "maya@example.com");
  assert.equal(normalizePayoutEmail("maya"), null);
  assert.equal(normalizePayoutEmail("ABCDEFGHIJKLM"), null);
});

test("organizers see readiness labels only; unclaimed copy is plain", () => {
  assert.equal(payoutReadinessLabel(PayoutReadiness.READY), "Ready to be paid");
  assert.equal(
    payoutReadinessLabel(PayoutReadiness.NEEDS_EMAIL),
    "Needs a payout email",
  );
  assert.equal(payoutReadinessLabel("SAVED_UNVERIFIED"), "Status unavailable");
  assert.equal(unclaimedPayoutLabel("Maya"), "Waiting for Maya to claim it");
});

test("settings shows only the viewer's own email and no merchant-ID pattern", () => {
  const settings = source("components/payment-account-settings.tsx");
  assert.match(settings, /Your PayPal email/);
  assert.match(settings, /Change/);
  assert.doesNotMatch(settings, /A-Z0-9\]\{13\}|maxLength=\{13\}|merchant/i);
  assert.doesNotMatch(settings, /accountHint|ownPaypalId/);
});
