import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PayoutEmailStep,
  PayoutReadiness,
  PayoutStepPlace,
  normalizePayoutEmail,
  payoutReadinessLabel,
  unclaimedPayoutLabel,
} from "../components/payout-email-step";

const source = (file: string) =>
  readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("after approval: one heading, the field, Save and Do this later", () => {
  const html = renderToStaticMarkup(
    createElement(PayoutEmailStep, { onDone: () => {} }),
  );
  assert.match(html, /Where should we send your money\?/);
  assert.match(html, />PayPal email</);
  assert.match(html, /No PayPal yet\? You’ll get an email to claim it\./);
  assert.match(html, /type="email"/);
  assert.match(html, /autoComplete="email"|autocomplete="email"/);
  assert.match(html, />Save</);
  assert.match(html, />Do this later</);
  assert.equal(html.match(/<h2/g)?.length, 1);
  // Nothing is saved yet, so there is no in-flight note.
  assert.doesNotMatch(html, /already on their way/);
  assert.doesNotMatch(
    html,
    /merchant|13|sandbox|Where should we send your share/i,
  );
});

test("in settings: no heading, no Do this later; Cancel only when changing", () => {
  const empty = renderToStaticMarkup(
    createElement(PayoutEmailStep, {
      onDone: () => {},
      place: PayoutStepPlace.SETTINGS,
    }),
  );
  assert.doesNotMatch(empty, /<h2|Where should we send|Do this later|Cancel/);
  assert.doesNotMatch(empty, /aria-labelledby/);
  assert.match(empty, />Save</);
  const changing = renderToStaticMarkup(
    createElement(PayoutEmailStep, {
      onDone: () => {},
      onCancel: () => {},
      place: PayoutStepPlace.SETTINGS,
    }),
  );
  assert.match(changing, />Cancel</);
  assert.doesNotMatch(changing, /Do this later/);
  // The in-flight note appears once the saved email loads.
  const step = source("components/payout-email-step.tsx");
  assert.match(
    step,
    /\{changing && \(\s*<p id=\{noteId\}[^>]*>\s*Payments already on their way keep the old address\./,
  );
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

test("settings: one Getting paid card, the email plainly, no duplicate copy", () => {
  const settings = source("components/payment-account-settings.tsx");
  assert.match(settings, /<h3>Getting paid<\/h3>/);
  assert.match(
    settings,
    /Your share from every agreement goes to this PayPal email\./,
  );
  assert.match(settings, /Change/);
  assert.match(settings, /PayPalConnected/);
  assert.match(settings, /place=\{PayoutStepPlace\.SETTINGS\}/);
  assert.match(settings, /Test mode/);
  assert.match(settings, /role="tooltip"[\s\S]*Use a PayPal sandbox email/);
  assert.doesNotMatch(
    settings,
    /Your PayPal email<|No email yet|saved earlier|sandbox email\.|Do this later/,
  );
  assert.doesNotMatch(settings, /A-Z0-9\]\{13\}|maxLength=\{13\}|merchant/i);
  assert.doesNotMatch(settings, /accountHint|ownPaypalId/);
  assert.match(
    settings,
    /!changing && data\.own\?\.type === PayoutRecipientType\.PAYPAL_ID/,
  );
  assert.match(
    settings,
    /Your share from every agreement goes to this PayPal account\./,
  );
  assert.match(settings, /Remove your \{payoutLabel\}\?/);
  // Removing confirms with the inline note, like saving.
  assert.match(settings, /setSaved\("Removed"\)/);
});

test("settings: no platform PayPal card, inline Saved, row menu for reminders", () => {
  const settings = source("components/payment-account-settings.tsx");
  // The platform's PayPal app is not the user's to configure; only say so
  // when payments are actually off.
  assert.doesNotMatch(settings, /Receiving payments|Not configured|WalletIcon/);
  assert.match(
    settings,
    /!data\.providerConfigured && \([\s\S]*Payments are off on this server/,
  );
  // Saving confirms inside the card and fades, not as loose text on top.
  assert.doesNotMatch(settings, /PayPal email saved\./);
  assert.match(settings, /setSaved\("Saved"\)/);
  assert.match(settings, /settings-card-head[\s\S]*<SavedNote/);
  // Reminders use the shared portal menu so the settings table cannot clip it.
  assert.match(settings, /<strong>Collaborators<\/strong>/);
  assert.match(
    settings,
    /<ActionMenu[\s\S]*label=\{`Actions for \$\{m\.name\}`\}[\s\S]*label: "Copy reminder"/,
  );
  assert.doesNotMatch(settings, /<details className="ag-menu"/);
});
