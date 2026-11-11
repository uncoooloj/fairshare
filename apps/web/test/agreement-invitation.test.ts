import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";
const read = (name: string) =>
  readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");
test("scoped invitation uses fragment token and separate scoped accept; original workspace links remain", () => {
  const app = appSource(),
    invitation = read("agreement-invitation.tsx");
  assert.match(invitation, /\/invitation#token=/);
  assert.match(
    invitation,
    /encodeURIComponent\(AGREEMENT_INVITE_PREFIX \+ invitation.token\)/,
  );
  assert.match(
    app,
    /scoped \? "agreement-invitations\/accept" : "invitations\/accept"/,
  );
  assert.match(app, /setSelected\(result.agreement\)/);
  assert.match(invitation, /No email\s+is sent/);
});
test("invitation context comes from server, shows signed-in account and explicit scope", () => {
  const source = read("agreement-invitation.tsx");
  assert.match(source, /api\("agreement-invitations\/preview", "POST"/);
  assert.match(source, /preview.agreementName/);
  assert.match(source, /preview.inviterName/);
  assert.match(source, /<Avatar name=\{preview.inviterName\}/);
  assert.match(source, /asking you to review how the money is split/);
  assert.match(source, /<strong>\{email\}<\/strong>/);
  assert.match(source, /Access is limited to this agreement/);
  assert.match(source, /Accepting this invitation doesn’t approve the terms/);
  assert.match(source, /"Accept"/);
  assert.match(source, /export function InvitationSignInContext/);
});
test("approval success leads to the get-paid step; it saves only on submit and can be skipped", () => {
  const app = appSource(),
    prompt = read("post-approval-payout.tsx");
  assert.match(app, /setApprovedForPayout\(selected.id\)/);
  assert.match(prompt, /recipient-status/);
  assert.match(prompt, /<PayoutEmailStep[\s\S]*autoFocus/);
  // "You approved" already says it; no second sentence.
  assert.doesNotMatch(prompt, /Your approval is already saved/);
  // The only write is PayoutEmailStep's explicit Save; "Do this later" lives there.
  assert.doesNotMatch(prompt, /"PUT"|"POST"|paypalId|\{13\}/);
  assert.match(prompt, /PayoutStepResult.SAVED/);
});
test("signed-out invite page names the inviter and agreement above sign-in", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { InvitationSignInCopy, agreementInviteTokenFromHash } = await import(
    "../components/agreement-invitation"
  );
  const html = renderToStaticMarkup(
    createElement(InvitationSignInCopy, {
      preview: {
        agreementName: "Midnight Sessions",
        inviterName: "Maya Okafor",
        expiresAt: 0,
      },
    }),
  );
  assert.match(html, /Maya Okafor invited you to Midnight Sessions/);
  assert.match(html, /Sign in or create an account to review it\./);
  assert.doesNotMatch(html, /\$|%|@/);
  // Before the preview loads (or if it fails) the copy stays generic.
  assert.match(
    renderToStaticMarkup(
      createElement(InvitationSignInCopy, { preview: null }),
    ),
    /invited to review an agreement/,
  );
  // The token is read from the fragment only, so it is never sent as a query or path.
  assert.equal(
    agreementInviteTokenFromHash("#token=agreement%3Aabc_DEF-123"),
    "abc_DEF-123",
  );
  assert.equal(agreementInviteTokenFromHash("#token=workspace-token"), null);
  assert.equal(agreementInviteTokenFromHash("#token=%E0%A4%A"), null);
  const source = read("agreement-invitation.tsx");
  assert.match(source, /agreementInviteTokenFromHash\(location.hash\)/);
});
