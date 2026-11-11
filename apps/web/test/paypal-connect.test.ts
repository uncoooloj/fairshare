import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PayPalConnectChoice,
  PayPalConnectFlag,
  PayPalConnected,
  maskPayoutEmail,
  paypalFlagMessage,
  safeReturnPath,
  withPayPalFlag,
} from "../components/paypal-connect";
import {
  payoutReadinessLabel,
  PayoutReadiness,
} from "../components/payout-email-step";

const source = (file: string) =>
  readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("connect button is hidden when PayPal Identity isn't configured", () => {
  const html = renderToStaticMarkup(
    createElement(PayPalConnectChoice, {
      available: false,
      verifiedEmail: null,
    }),
  );
  assert.equal(html, "");
});

test("connect button is a plain PayPal-styled button when configured", () => {
  const html = renderToStaticMarkup(
    createElement(PayPalConnectChoice, {
      available: true,
      verifiedEmail: null,
    }),
  );
  assert.match(
    html,
    /<button[^>]*type="button"[^>]*class="paypal-connect-button"/,
  );
  assert.match(html, /Connect with/);
  assert.match(html, /aria-label="PayPal"/);
  assert.match(html, /Or type it yourself/);
  assert.doesNotMatch(html, /<script|<img|paypalobjects/);
});

test("after connecting the owner sees a masked, verified line", () => {
  for (const html of [
    renderToStaticMarkup(
      createElement(PayPalConnectChoice, {
        available: true,
        verifiedEmail: "maya.pay@example.test",
      }),
    ),
    renderToStaticMarkup(
      createElement(PayPalConnected, { email: "maya.pay@example.test" }),
    ),
  ]) {
    assert.match(html, /Connected · m•••@example\.test · /);
    assert.match(html, /Verified by PayPal/);
    assert.match(html, />Disconnect</);
    assert.doesNotMatch(html, /maya\.pay/);
  }
  assert.equal(maskPayoutEmail("j@gmail.com"), "j•••@gmail.com");
  assert.equal(maskPayoutEmail("nope"), "•••");
});

test("organizers still only get readiness labels", () => {
  assert.equal(payoutReadinessLabel(PayoutReadiness.READY), "Ready to be paid");
  const settings = source("components/payment-account-settings.tsx");
  // The member table renders status only; the verified line uses data.own.
  const table = settings.slice(settings.indexOf("Collaborator accounts"));
  assert.doesNotMatch(table, /Verified by PayPal|PayPalConnected|\.value/);
  assert.match(settings, /data\.paypalConnect &&/);
});

test("return flag and paths stay on this site", () => {
  assert.equal(
    withPayPalFlag("/app/settings?tab=payments", PayPalConnectFlag.CONNECTED),
    "/app/settings?tab=payments&paypal=connected",
  );
  for (const bad of ["https://evil.test/x", "//evil.test", "/\\evil", null])
    assert.equal(safeReturnPath(bad), "/app");
  assert.match(paypalFlagMessage(PayPalConnectFlag.UNVERIFIED), /confirmed/);
  assert.equal(paypalFlagMessage(null), "");
});

test("return page posts code and state, strips them, and never loads PayPal scripts", () => {
  const page = source("components/paypal-return.tsx");
  assert.match(page, /PAYPAL_CALLBACK_PATH, "POST", \{ code, state \}/);
  assert.match(page, /history\.replaceState/);
  assert.match(source("app/paypal/return/page.tsx"), /no-referrer/);
  const all = page + source("components/paypal-connect.tsx");
  assert.doesNotMatch(all, /<script|paypalobjects|client_secret|clientSecret/i);
});
