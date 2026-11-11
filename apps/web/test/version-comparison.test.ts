import test from "node:test";
import assert from "node:assert/strict";
import { changedRuleFields, changedShares } from "../lib/version-comparison";
import type { Rules } from "../lib/model";
const rules: Rules = {
  currency: "USD",
  shares: [
    { userId: "a", basisPoints: 5000 },
    { userId: "b", basisPoints: 5000 },
  ],
  feePolicy: "BEFORE_SPLIT",
  unresolvedQuestions: [],
  source: {
    origin: "HUMAN_PROPOSAL",
    documentId: "d",
    clause: "4.2",
    excerpt: "half each",
  },
};
test("same rules and reordered shares are unchanged", () => {
  assert.deepEqual(
    changedRuleFields(rules, { ...rules, shares: [...rules.shares].reverse() }),
    [],
  );
  assert.deepEqual(changedShares(rules, rules), []);
});
test("changed shares expose exact old/new basis points without mutating history", () => {
  const next = {
    ...rules,
    shares: [
      { userId: "a", basisPoints: 7500 },
      { userId: "b", basisPoints: 2500 },
    ],
  };
  assert.deepEqual(changedRuleFields(rules, next), ["shares"]);
  assert.deepEqual(changedShares(rules, next), [
    { userId: "a", before: 5000, after: 7500 },
    { userId: "b", before: 5000, after: 2500 },
  ]);
  assert.equal(rules.shares[0].basisPoints, 5000);
});
test("added/removed recipient differs from a zero share", () => {
  assert.deepEqual(
    changedShares(rules, {
      ...rules,
      shares: [
        { userId: "a", basisPoints: 10000 },
        { userId: "c", basisPoints: 0 },
      ],
    }).slice(1),
    [
      { userId: "b", before: 5000, after: undefined },
      { userId: "c", before: undefined, after: 0 },
    ],
  );
});
test("same quote from another document and changed origin are visible", () => {
  assert.deepEqual(
    changedRuleFields(rules, {
      ...rules,
      source: { ...rules.source, documentId: "other" },
    }),
    ["source"],
  );
  assert.deepEqual(
    changedRuleFields(rules, {
      ...rules,
      source: { ...rules.source, origin: "AI" },
    }),
    ["source"],
  );
});
test("fee bearer matters only when that fee policy uses one", () => {
  assert.deepEqual(
    changedRuleFields(rules, { ...rules, feeBearerId: "a" }),
    [],
  );
  assert.deepEqual(
    changedRuleFields(rules, {
      ...rules,
      feePolicy: "FEE_BEARER",
      feeBearerId: "a",
    }),
    ["fees"],
  );
});
test("advance identity, amount, verification and source all participate", () => {
  const before = {
    ...rules,
    advance: {
      id: "adv",
      recipientId: "a",
      amountCents: 200000,
      verified: true,
      source: rules.source,
    },
  };
  for (const patch of [
    { id: "new" },
    { amountCents: 100000 },
    { verified: false },
    { source: { ...rules.source, excerpt: "new" } },
  ]) {
    assert.deepEqual(
      changedRuleFields(before, {
        ...before,
        advance: { ...before.advance, ...patch },
      }),
      ["advance"],
    );
  }
});
test("question order is not a change but resolution is", () => {
  const before = { ...rules, unresolvedQuestions: ["a", "b"] };
  assert.deepEqual(
    changedRuleFields(before, { ...before, unresolvedQuestions: ["b", "a"] }),
    [],
  );
  assert.deepEqual(changedRuleFields(before, rules), ["questions"]);
});
