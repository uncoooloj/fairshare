import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CloseButton } from "../components/close-button";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("CloseButton is an icon-only × with an accessible name", () => {
  const html = renderToStaticMarkup(
    createElement(CloseButton, { onClick: () => {} }),
  );
  assert.match(html, /^<button type="button"/);
  assert.match(html, /class="icon-button close-button"/);
  assert.match(html, /aria-label="Close"/);
  assert.match(html, /<svg[^>]+aria-hidden="true"/);
  // No visible text: the icon is the only content.
  assert.equal(html.replace(/<[^>]+>/g, ""), "");
});

test("CloseButton takes a specific label, disabled and extra classes", () => {
  const html = renderToStaticMarkup(
    createElement(CloseButton, {
      onClick: () => {},
      label: "Close notifications",
      disabled: true,
      className: "extra",
    }),
  );
  assert.match(html, /aria-label="Close notifications"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /class="icon-button close-button extra"/);
});

test("CloseButton has a 32px target and a visible focus ring", () => {
  const css = source("../app/design-polish.css");
  assert.match(css, /\.icon-button \{\s*width: 32px;\s*height: 32px;/);
  assert.match(
    css,
    /\.close-button:focus-visible \{\s*outline: 2px solid var\(--color-brand\);/,
  );
});

test("panels, drawers and dialogs close with the shared × instead of text", () => {
  for (const path of [
    "../components/notification-panel.tsx",
    "../components/send-review-confirmation.tsx",
    "../components/change-request-drawer.tsx",
    "../components/something-wrong-drawer.tsx",
    "../components/allocation-drawer.tsx",
    "../components/sections/agreement-tabs/payment-breakdown.tsx",
    "../src/components/PayoutDetails.tsx",
  ]) {
    const file = source(path);
    assert.match(file, /<CloseButton/, path);
    assert.doesNotMatch(file, />\s*(Close|Done|×)\s*</, path);
  }
});
