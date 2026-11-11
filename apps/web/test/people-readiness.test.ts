import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { approvalLabel, payoutReadinessLabel } from "../lib/people-readiness";
import type { Version } from "../lib/model";
const version = {
  id: 3,
  status: "AWAITING_APPROVAL",
  approvals: {},
  changeRequests: [],
} as unknown as Version;
test("review state does not invent pending approval before proposal or send", () => {
  assert.equal(approvalLabel(undefined, "u"), "No proposal yet");
  assert.equal(
    approvalLabel({ ...version, status: "DRAFT" }, "u"),
    "Not sent yet",
  );
  assert.equal(approvalLabel(version, "u"), "Awaiting review");
  assert.equal(
    approvalLabel({ ...version, approvals: { u: "now" } }, "u"),
    "Approved",
  );
  assert.equal(
    approvalLabel(
      {
        ...version,
        changeRequests: [{ userId: "u", reason: "Review fee", at: "now" }],
      },
      "u",
    ),
    "Changes requested",
  );
});
test("organizers see readiness only, never a destination", () => {
  assert.equal(payoutReadinessLabel("READY"), "Ready to be paid");
  assert.equal(payoutReadinessLabel("NEEDS_EMAIL"), "Needs a payout email");
  assert.equal(payoutReadinessLabel("SAVED_UNVERIFIED"), "Status unavailable");
  assert.equal(payoutReadinessLabel(undefined), "Status unavailable");
});
test("row actions do not mutate membership or expose other people's destinations", () => {
  const source = readFileSync(
    new URL("../components/agreement-people.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /"DELETE"|"PATCH"|"POST"|"PUT"|ownPaypalId/);
  assert.match(
    source,
    /canRemind\(\s*currentAgreement,\s*currentVersion,\s*userId,\s*member.userId,?\s*\)/,
  );
  assert.match(source, /member.userId === userId/);
  assert.doesNotMatch(source, /accountHint|PayPal ID|recipient ID|merchant/i);
  assert.match(source, /<PayoutEmailStep/);
  assert.match(source, /if \(active\)/);
});

test("organizers can recover a sent pending person's link without putting its token in a query", async () => {
  const { isCurrentReissue, personInviteLink } = await import(
    "../components/agreement-people"
  );
  const source = readFileSync(
    new URL("../components/agreement-people.tsx", import.meta.url),
    "utf8",
  );
  const link = personInviteLink(
    "one-time-token",
    "https://fairshare-web.udaleamehoj.workers.dev",
  );
  assert.equal(
    link,
    "https://usefairshare.app/invitation#token=agreement%3Aone-time-token",
  );
  assert.match(source, /organizer && sent && isPendingMember\(member\)/);
  assert.match(source, /replacePersonLink\(/);
  assert.match(source, /currentAgreement\.revision/);
  assert.equal(isCurrentReissue(7, 7), true);
  assert.equal(isCurrentReissue(7, 8), false, "late responses stay ignored");
  assert.match(source, /onAgreementChange\?\.\(result\.agreement\)/);
  assert.match(source, /agreementIdentityRef\.current !== requestIdentity/);
});

test("reissued agreements propagate to the app state by composite identity", () => {
  const tab = readFileSync(
    new URL(
      "../components/sections/agreement-tabs/people-tab.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const detail = readFileSync(
    new URL("../components/sections/agreement-detail.tsx", import.meta.url),
    "utf8",
  );
  const app = readFileSync(
    new URL("../components/fairshare-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(tab, /key=\{`\$\{selected\.workspaceId\}:\$\{selected\.id\}`\}/);
  assert.match(tab, /onAgreementChange=\{onAgreementChange\}/);
  assert.match(detail, /onAgreementChange=\{onAgreementChange\}/);
  assert.match(app, /current\.workspaceId !== next\.workspaceId/);
  assert.match(app, /next\.revision < current\.revision/);
});
