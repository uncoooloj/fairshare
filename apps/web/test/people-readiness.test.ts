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
test("row actions do not mutate membership, other people's destinations, or resend email", () => {
  const source = readFileSync(
    new URL("../components/agreement-people.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /"DELETE"|"PATCH"|"POST"|"PUT"|ownPaypalId/);
  assert.match(
    source,
    /canRemind\(\s*agreement,\s*version,\s*userId,\s*member.userId,?\s*\)/,
  );
  assert.match(source, /member.userId === userId/);
  assert.doesNotMatch(source, /accountHint|PayPal ID|recipient ID|merchant/i);
  assert.match(source, /<PayoutEmailStep/);
  assert.match(source, /if \(active\)/);
});
