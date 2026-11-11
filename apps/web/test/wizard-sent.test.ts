import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  invitationInstructions,
  WizardSentStep,
  type SentInvite,
} from "../components/wizard-sent-step";

const invite = (name: string): SentInvite => ({
  key: name,
  name,
  email: `${name.split(" ")[0].toLowerCase()}@example.test`,
  workspaceId: "workspace",
  agreementId: "agreement",
  userId: `pending:${name}`,
  invitationId: name,
  token: "synthetic-invitation-token",
  expiresAt: Date.now() + 60_000,
});

function render(invites: SentInvite[]) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { origin: "https://example.test" },
  });
  try {
    return renderToStaticMarkup(createElement(WizardSentStep, { invites }));
  } finally {
    if (original) Object.defineProperty(globalThis, "location", original);
    else Reflect.deleteProperty(globalThis, "location");
  }
}

test("ready invitations ask the organizer to share, without claiming they were sent", () => {
  const html = render([invite("Jordan Reyes"), invite("Riley Chen")]);
  assert.match(html, /<h1[^>]*>Invite Jordan and Riley<\/h1>/);
  assert.match(
    html,
    /Share each person’s link so they can review and approve the split\./,
  );
  assert.equal((html.match(/>Copy link<\/button>/g) || []).length, 2);
  assert.equal((html.match(/>Share<\/button>/g) || []).length, 2);
  assert.doesNotMatch(
    html,
    /Sent to|We don’t email|unavailable|Email invitation/,
  );
});

test("instructions offer email only with the confirmed capability", () => {
  assert.equal(
    invitationInstructions(false),
    "Share each person’s link so they can review and approve the split.",
  );
  assert.equal(
    invitationInstructions(true),
    "Share each person’s link or email their invitation so they can review and approve the split.",
  );
  for (const enabled of [false, true])
    assert.doesNotMatch(
      invitationInstructions(enabled),
      /sent|emailed|delivered|yet/i,
    );
});

test("one invite and the empty fallback retain an actionable heading", () => {
  assert.match(
    render([invite("Jordan Reyes")]),
    /<h1[^>]*>Invite Jordan<\/h1>/,
  );
  assert.match(render([]), /<h1[^>]*>Invite your collaborators<\/h1>/);
});
