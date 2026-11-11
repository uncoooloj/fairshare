import { test } from "node:test";
import assert from "node:assert/strict";
import { overviewSummary, type OverviewPayout } from "../lib/overview-summary";
import type { Agreement } from "../lib/model";
function fixture(): Agreement {
  return {
    id: "a",
    workspaceId: "w",
    revision: 1,
    value: {
      name: "Studio",
      members: [
        { userId: "me", displayName: "Maya", role: "ORGANIZER" },
        { userId: "other", displayName: "Riley", role: "COLLABORATOR" },
      ],
      versions: [
        {
          id: 1,
          status: "AWAITING_APPROVAL",
          approvals: {},
          changeRequests: [],
          rules: {
            currency: "USD",
            shares: [],
            feePolicy: "BEFORE_SPLIT",
            source: {
              origin: "DOCUMENT",
              documentId: "d",
              clause: "4",
              excerpt: "split",
            },
            unresolvedQuestions: [],
          },
        },
      ],
      revenue: [
        {
          providerCaptureId: "cap",
          versionId: 1,
          grossCents: 100,
          feeCents: 0,
          netCents: 100,
          at: "2026-11-10T10:00:00Z",
          status: "ALLOCATED",
          allocations: [
            {
              userId: "me",
              recoupmentCents: 0,
              shareCents: 100,
              feeCents: 0,
              totalCents: 100,
              status: "ALLOCATED",
            },
          ],
        },
      ],
      reviewHold: false,
      recoupedByAdvance: {},
      audit: [
        {
          sequence: 1,
          type: "CREATED",
          at: "2026-11-10T10:00:00Z",
          actorId: "me",
        },
      ],
    },
  };
}
function payout(a: Agreement, status = "SUCCESS"): OverviewPayout {
  return {
    id: "p",
    agreement: a,
    capture_id: "cap",
    user_id: "me",
    amount: 100,
    status,
  };
}
test("totals use successful matched payouts, not submitted batches", () => {
  const a = fixture();
  assert.equal(overviewSummary([a], [payout(a, "PENDING")], "me").paid, 0);
  const s = overviewSummary([a], [payout(a)], "me");
  assert.equal(s.allocated, 100);
  assert.equal(s.paid, 100);
  assert.equal(s.remaining, 0);
});
test("unknown, unclaimed, reversed and mismatched payouts never inflate paid", () => {
  const a = fixture();
  for (const status of ["OUTCOME_UNKNOWN", "UNCLAIMED", "REVERSED", "REFUNDED"])
    assert.equal(overviewSummary([a], [payout(a, status)], "me").paid, 0);
  assert.equal(
    overviewSummary([a], [{ ...payout(a), amount: 200 }], "me").paid,
    0,
  );
  assert.equal(
    overviewSummary([a], [{ ...payout(a), capture_id: "unknown" }], "me").paid,
    0,
  );
});
test("duplicate operations and allocations count only once", () => {
  const a = fixture();
  a.value.revenue.push(structuredClone(a.value.revenue[0]));
  const s = overviewSummary([a], [payout(a), { ...payout(a), id: "p2" }], "me");
  assert.equal(s.allocated, 100);
  assert.equal(s.paid, 100);
});
test("approval prompts separate current user and others; viewers cannot approve", () => {
  const a = fixture();
  let s = overviewSummary([a], [], "me");
  assert.equal(s.attention.length, 1);
  assert.match(s.waiting[0].title, /Riley/);
  a.value.versions[0].approvals.me = "2026-11-10T12:00:00Z";
  s = overviewSummary([a], [], "me");
  assert.equal(s.attention.length, 0);
  assert.equal(overviewSummary([a], [], "viewer").attention.length, 0);
});
test("holds are visible and activity uses recorded times, newest first", () => {
  const a = fixture();
  a.value.reviewHold = true;
  a.value.audit.push({
    sequence: 2,
    type: "PAYMENT_HELD",
    actorId: "provider",
    at: "2026-11-11T10:00:00Z",
  });
  const s = overviewSummary([a], [payout(a, "OUTCOME_UNKNOWN")], "me");
  assert.equal(s.attention.length, 3);
  assert.equal(s.activity[0].text, "Payment placed on hold");
  assert.equal(s.activity[1].text, "You created the agreement");
  assert.equal(s.remaining, 100);
});
test("empty workspace has honest zero totals and no synthetic activity", () => {
  const s = overviewSummary([], [], "me");
  assert.equal(s.allocated, 0);
  assert.equal(s.paid, 0);
  assert.deepEqual(s.activity, []);
  assert.deepEqual(s.attention, []);
});

test("incomplete payout loads never present financial totals as zero", () => {
  const a = fixture();
  const s = overviewSummary([a], [], "me", false);
  assert.equal(s.allocated, null);
  assert.equal(s.paid, null);
  assert.equal(s.remaining, null);
});

test("review actions use the authoritative review state", () => {
  const a = fixture();
  a.value.versions[0].approvals = {
    me: "2026-11-10T12:00:00Z",
    other: "2026-11-10T12:00:00Z",
  };
  assert.match(
    overviewSummary([a], [], "me").attention[0].title,
    /Activate version 1/,
  );
  assert.match(
    overviewSummary([a], [], "other").waiting[0].title,
    /Waiting for organizer to activate version 1/,
  );
  a.value.versions[0].status = "ACTIVE";
  assert.equal(overviewSummary([a], [], "other").waiting.length, 0);

  const draft = fixture();
  draft.value.versions[0].status = "DRAFT";
  assert.match(
    overviewSummary([draft], [], "me").attention[0].title,
    /Send version 1 for review/,
  );
  draft.value.versions[0].rules.advance = {
    id: "advance",
    recipientId: "me",
    amountCents: 10,
    verified: false,
    source: draft.value.versions[0].rules.source,
  };
  assert.match(
    overviewSummary([draft], [], "me").attention[0].detail,
    /Verify the existing advance/,
  );
});
