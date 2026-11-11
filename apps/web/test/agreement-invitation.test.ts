import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name: string) =>
  readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");
test("scoped invitation uses fragment token and separate scoped accept; original workspace links remain", () => {
  const app = read("fairshare-app.tsx"),
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
  assert.match(source, /Joining as/);
  assert.match(source, /collaborator on this\s+agreement/);
  assert.match(source, /Accept and open agreement/);
});
test("approval success triggers payout status prompt; later neither undoes approval nor auto-saves", () => {
  const app = read("fairshare-app.tsx"),
    prompt = read("post-approval-payout.tsx");
  assert.match(app, /if \(action === "approve"\)/);
  assert.match(app, /setApprovedForPayout\(selected.id\)/);
  assert.match(prompt, /recipient-status/);
  assert.match(prompt, /without losing your approval/);
  assert.match(prompt, /not a guarantee of\s+provider verification/);
  assert.doesNotMatch(prompt, /"PUT"|"POST"/);
});
