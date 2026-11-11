import { test } from "node:test";
import assert from "node:assert/strict";
import {
  overviewSummary,
  splitSentences,
  type OverviewPayout,
} from "../lib/overview-summary";
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
          currency: "USD",
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
test("advance summary reports allocated progress while its payout is pending", () => {
  const a = fixture();
  const rules = a.value.versions[0].rules;
  rules.advance = {
    id: "advance",
    recipientId: "me",
    amountCents: 100,
    verified: true,
    source: rules.source,
  };
  a.value.recoupedByAdvance.advance = 50;

  assert.equal(overviewSummary([a], [payout(a, "PENDING")], "me").paid, 0);
  assert.ok(
    splitSentences(a, rules, "me").includes(
      "$1 is allocated toward your advance before the split ($0.50 allocated so far).",
    ),
  );
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
  assert.equal(s.activity[0].text, "Payment paused for a check");
  assert.equal(s.activity[1].text, "You created the agreement");
  assert.equal(s.remaining, 100);
});
test("recipient and automatic payout holds remain visible until resolved", () => {
  const a = fixture();
  for (const status of ["WAITING_RECIPIENT", "AUTO_HELD"]) {
    const summary = overviewSummary([a], [payout(a, status)], "me");
    const item = summary.attention.find((item) =>
      item.key.startsWith("payout:"),
    );
    assert.ok(item);
    assert.match(
      item.detail,
      new RegExp(status.toLowerCase().replaceAll("_", " ")),
    );
  }
});
test("empty workspace has honest zero totals and no synthetic activity", () => {
  const s = overviewSummary([], [], "me");
  assert.equal(s.allocated, 0);
  assert.equal(s.paid, 0);
  assert.deepEqual(s.activity, []);
  assert.deepEqual(s.attention, []);
});

test("Riley sees their $200 allocation, not the agreement's $3000", () => {
  const a = fixture();
  a.value.revenue[0].allocations = [
    { ...a.value.revenue[0].allocations[0], totalCents: 280000 },
    {
      ...a.value.revenue[0].allocations[0],
      userId: "other",
      totalCents: 20000,
    },
  ];
  const payouts = [
    { ...payout(a), amount: 280000 },
    {
      ...payout(a),
      id: "riley",
      user_id: "other",
      amount: 20000,
      status: "PENDING",
    },
  ];
  const riley = overviewSummary([a], payouts, "other");
  assert.equal(riley.scope, "personal");
  assert.equal(riley.allocated, 20000);
  assert.equal(riley.paid, 0);
  assert.equal(riley.remaining, 20000);
  assert.equal(overviewSummary([a], payouts, "me").allocated, 300000);
  payouts[1].status = "SUCCESS";
  assert.equal(overviewSummary([a], payouts, "other").paid, 20000);
});

test("mixed roles and duplicate agreement ids remain tenant scoped", () => {
  const managed = fixture();
  const personal = structuredClone(managed);
  personal.workspaceId = "second";
  personal.value.members[0].role = "COLLABORATOR";
  personal.value.revenue[0].allocations.push({
    ...personal.value.revenue[0].allocations[0],
    userId: "other",
    totalCents: 900,
  });
  const s = overviewSummary(
    [managed, personal, personal],
    [payout(managed), payout(personal)],
    "me",
  );
  assert.equal(s.scope, "mixed");
  assert.equal(s.allocated, 200);
  assert.equal(s.paid, 200);
  assert.equal(s.remaining, 0);
});

test("nonmembers and other recipients cannot leak totals or payout attention", () => {
  const a = fixture();
  const outsider = overviewSummary([a], [payout(a, "FAILED")], "outsider");
  assert.equal(outsider.allocated, 0);
  assert.deepEqual(outsider.activity, []);
  assert.deepEqual(outsider.waiting, []);
  assert.deepEqual(outsider.attention, []);
  const collaborator = overviewSummary([a], [payout(a, "FAILED")], "other");
  assert.equal(collaborator.allocated, 0);
  assert.ok(
    !collaborator.attention.some((item) => item.key.startsWith("payout:")),
  );
  const forged = {
    ...payout(a),
    agreement: { ...a, workspaceId: "elsewhere" },
  };
  assert.equal(overviewSummary([a], [forged], "me").paid, 0);
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
  const organizer = overviewSummary([a], [], "me");
  assert.match(organizer.attention[0].title, /Switch on the new split/);
  assert.equal(organizer.attention[0].key, '["w","a"]:activate');
  const collaborator = overviewSummary([a], [], "other");
  assert.match(
    collaborator.waiting[0].title,
    /Waiting for the organizer to switch it on/,
  );
  assert.equal(collaborator.waiting[0].key, '["w","a"]:waiting-activation');
  a.value.versions[0].status = "ACTIVE";
  assert.equal(overviewSummary([a], [], "other").waiting.length, 0);

  const draft = fixture();
  draft.value.versions[0].status = "DRAFT";
  const send = overviewSummary([draft], [], "me");
  assert.match(send.attention[0].title, /Send the split for approval/);
  assert.equal(send.attention[0].key, '["w","a"]:send-review');
  draft.value.versions[0].rules.advance = {
    id: "advance",
    recipientId: "me",
    amountCents: 10,
    verified: false,
    source: draft.value.versions[0].rules.source,
  };
  const blocked = overviewSummary([draft], [], "me");
  assert.match(blocked.attention[0].detail, /Confirm the advance amount/);
  assert.equal(blocked.attention[0].key, '["w","a"]:review-blockers');
});

test("agreement status line is role-aware and needs no organizer switch-on", async () => {
  const { agreementStatus, AgreementStage, StageAction } = await import(
    "../lib/agreement-status"
  );
  const a = fixture();
  a.value.members = [
    { userId: "me", displayName: "Maya Okafor", role: "ORGANIZER" },
    { userId: "riley", displayName: "Riley Chen", role: "COLLABORATOR" },
    { userId: "jordan", displayName: "Jordan Reyes", role: "COLLABORATOR" },
  ];
  const v = a.value.versions[0];
  v.status = "AWAITING_APPROVAL";
  v.approvals = { me: "2026-11-10T12:00:00Z" };
  assert.equal(
    agreementStatus(a, "me").line,
    "Waiting for Riley and Jordan to approve",
  );
  const riley = agreementStatus(a, "riley");
  assert.equal(riley.line, "Waiting for you to approve");
  assert.equal(riley.action, StageAction.Approve);
  v.approvals.riley = "2026-11-10T13:00:00Z";
  assert.equal(agreementStatus(a, "riley").line, "Waiting for Jordan");
  v.status = "DRAFT";
  v.approvals = {};
  v.changeRequests = [
    { userId: "riley", reason: "Fee", at: "2026-11-10T14:00:00Z" },
  ];
  const change = agreementStatus(a, "me");
  assert.equal(change.line, "Riley asked for a change");
  assert.equal(change.action, StageAction.SeeRequest);
  v.changeRequests = [];
  v.status = "ACTIVE";
  a.value.activeVersionId = v.id;
  assert.equal(
    agreementStatus(a, "me").line,
    "All set. Payments split automatically.",
  );
  assert.equal(agreementStatus(a, "jordan").line, "All set");
  assert.equal(agreementStatus(a, "jordan").stage, AgreementStage.AllSet);
});
