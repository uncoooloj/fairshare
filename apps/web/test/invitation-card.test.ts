import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { InvitationCard } from "../components/agreement-invitation";

const props = {
  preview: {
    inviterName: "Maya Okafor",
    agreementName: "Midnight Sessions",
    expiresAt: 1794600000000,
  },
  email: "reviewer@example.test",
  disabled: false,
  onAccept() {},
  onCancel() {},
  onRetry() {},
};

test("invitation action failures stay inside the visible card with a retryable acceptance button", () => {
  const html = renderToStaticMarkup(
    createElement(InvitationCard, {
      ...props,
      actionError: "You are already in this agreement.",
    }),
  );
  assert.match(
    html,
    /class="collab-invite-card"[\s\S]*role="alert"[\s\S]*You are already in this agreement/,
  );
  assert.match(html, />Accept<\/button>/);
  assert.match(html, /Accepting this invitation doesn’t approve the terms/);
  assert.match(html, /Maya Okafor/);
  assert.match(html, /Midnight Sessions/);
  const app = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(app, /<AgreementInvitationPreview[\s\S]*?error=\{error\}/);
});

test("accepted invitation is a clear return to review, not an expired new invitation", () => {
  const html = renderToStaticMarkup(
    createElement(InvitationCard, {
      ...props,
      preview: { ...props.preview, alreadyAccepted: true, expiresAt: 1 },
    }),
  );
  assert.match(html, /You’ve already joined/);
  assert.match(html, />Open agreement<\/button>/);
  assert.doesNotMatch(html, /Link expires/);
  assert.match(html, /Signed in/);
});

test("unavailable previews can retry or leave without accepting; pending action disables both buttons", () => {
  const unavailable = renderToStaticMarkup(
    createElement(InvitationCard, {
      ...props,
      preview: null,
      error: "Invitation is invalid or expired.",
    }),
  );
  assert.match(unavailable, /This invite can’t be opened/);
  assert.match(unavailable, />Try again<\/button>/);
  assert.match(unavailable, />Not now<\/button>/);
  assert.doesNotMatch(unavailable, />Accept<\/button>/);
  const busy = renderToStaticMarkup(
    createElement(InvitationCard, { ...props, disabled: true }),
  );
  assert.equal((busy.match(/disabled=""/g) || []).length, 2);
  assert.match(busy, /Opening…/);
  const source = readFileSync(
    new URL("../components/agreement-invitation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(pending.current \|\| busy\) return/);
});
