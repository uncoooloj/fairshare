import test from "node:test";
import assert from "node:assert/strict";
import { contractReviewState, formatRuleChange } from "../lib/contract-review";
import type { Agreement, Version } from "../lib/model";
const version: Version = {
  id: 2,
  status: "AWAITING_APPROVAL",
  approvals: { a: "now" },
  changeRequests: [],
  rules: {
    currency: "USD",
    feePolicy: "BEFORE_SPLIT",
    shares: [],
    unresolvedQuestions: [],
    source: {
      origin: "HUMAN_PROPOSAL",
      documentId: "d",
      clause: "1",
      excerpt: "proposal",
    },
  },
};
const agreement: Agreement = {
  id: "c",
  workspaceId: "w",
  revision: 1,
  value: {
    name: "Test",
    members: [
      { userId: "a", displayName: "A", role: "ORGANIZER" },
      { userId: "b", displayName: "B", role: "COLLABORATOR" },
    ],
    versions: [version],
    activeVersionId: 1,
    revenue: [],
    recoupedByAdvance: {},
    reviewHold: false,
    audit: [],
  },
};
test("review panel gates activation by unanimity and organizer without claiming automatic activation", () => {
  let state = contractReviewState(agreement, version, "a");
  assert.equal(state.canActivate, false);
  assert.equal(state.canApprove, false);
  assert.match(state.effect, /Version 1 is still in use/);
  const unanimous = { ...version, approvals: { a: "now", b: "now" } };
  state = contractReviewState(agreement, unanimous, "a");
  assert.equal(state.canActivate, true);
  assert.equal(state.heading, "Everyone approved. Ready to switch on.");
  assert.equal(
    contractReviewState(agreement, unanimous, "b").canActivate,
    false,
  );
  assert.equal(
    contractReviewState(agreement, unanimous, "outsider").canRequestChange,
    false,
  );
});
test("unresolved questions block sending, but an unpaid advance does not", () => {
  const draft = {
    ...version,
    status: "DRAFT",
    rules: {
      ...version.rules,
      unresolvedQuestions: ["Clarify costs"],
      advance: {
        id: "adv",
        recipientId: "a",
        amountCents: 100,
        verified: false,
        source: version.rules.source,
      },
    },
  };
  assert.equal(contractReviewState(agreement, draft, "a").canSend, false);
  assert.equal(contractReviewState(agreement, draft, "a").blockers.length, 1);
  const advanceOnly = {
    ...draft,
    rules: { ...draft.rules, unresolvedQuestions: [] },
  };
  const canSend = contractReviewState(agreement, advanceOnly, "a");
  assert.equal(canSend.canSend, true);
  assert.deepEqual(canSend.blockers, []);
  const allApproved = contractReviewState(
    {
      ...agreement,
      value: { ...agreement.value, versions: [advanceOnly] },
    },
    {
      ...advanceOnly,
      status: "AWAITING_APPROVAL",
      approvals: { a: "now", b: "now" },
    },
    "a",
  );
  assert.equal(allApproved.canActivate, false);
  assert.equal(
    allApproved.heading,
    "Everyone approved. Confirm the advance first.",
  );
  assert.match(allApproved.effect, /organizer confirms the advance is paid/);
  assert.equal(
    contractReviewState(agreement, { ...draft, rules: version.rules }, "b")
      .canSend,
    true,
  );
  assert.equal(
    contractReviewState(agreement, { ...version, id: 1 }, "b").canApprove,
    false,
  );
});
test("change requests preserve scope and require bounded meaningful reason", () => {
  assert.equal(
    formatRuleChange("Revenue split", "  Can we use 50/50?  "),
    "Revenue split: Can we use 50/50?",
  );
  assert.throws(() => formatRuleChange("", "  "));
  assert.throws(() => formatRuleChange("Fees", "a".repeat(2000)));
});
