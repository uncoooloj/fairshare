import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareFeePolicies, impactDraft } from "../lib/rule-impact";
import type { Agreement } from "../lib/model";
const agreement: Agreement = {
  id: "a",
  workspaceId: "w",
  revision: 1,
  value: {
    name: "Recordings",
    members: [
      { userId: "maya", displayName: "Maya", role: "ORGANIZER" },
      { userId: "jordan", displayName: "Jordan", role: "COLLABORATOR" },
      { userId: "riley", displayName: "Riley", role: "COLLABORATOR" },
    ],
    versions: [],
    revenue: [],
    recoupedByAdvance: {},
    reviewHold: false,
    audit: [],
  },
};
function draft(advance = true) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    maya: "50",
    jordan: "30",
    riley: "20",
    advance: "2000",
    recipient: "maya",
    verified: "on",
  }))
    form.set(key, value);
  return impactDraft(agreement, form, advance);
}
test("both supported fee interpretations conserve exact net cents with recoupment", () => {
  const before = JSON.stringify(agreement);
  const choices = compareFeePolicies(agreement, draft(), 300000, 10519);
  assert.deepEqual(
    choices[0].preview?.allocations.map((row) => row.totalCents),
    [244741, 26844, 17896],
  );
  assert.deepEqual(
    choices[1].preview?.allocations.map((row) => row.totalCents),
    [239481, 30000, 20000],
  );
  for (const choice of choices)
    assert.equal(
      choice.preview?.allocations.reduce((sum, row) => sum + row.totalCents, 0),
      289481,
    );
  assert.equal(JSON.stringify(agreement), before);
});
test("preview respects amounts already recouped and does not mutate the ledger", () => {
  const copy = structuredClone(agreement);
  copy.value.recoupedByAdvance["illustrative-advance"] = 200000;
  const result = compareFeePolicies(copy, draft(), 10000, 0);
  assert.deepEqual(
    result[0].preview?.allocations.map((row) => row.totalCents),
    [5000, 3000, 2000],
  );
  assert.equal(copy.value.recoupedByAdvance["illustrative-advance"], 200000);
});
test("unaffordable organizer fee blocks only that alternative", () => {
  const result = compareFeePolicies(agreement, draft(false), 100, 60);
  assert.equal(result[0].preview?.netCents, 40);
  assert.equal(result[1].preview, null);
  assert.match(result[1].error!, /cannot cover/);
});
test("missing or invalid terms and amounts cannot become default payouts", () => {
  assert.throws(() => impactDraft(agreement, new FormData(), false));
  const invalid = draft(false);
  invalid.shares[0].basisPoints = 4000;
  assert.throws(() => compareFeePolicies(agreement, invalid, 100, 0), /100%/);
  assert.throws(
    () => compareFeePolicies(agreement, draft(), 100, 101),
    /positive USD/,
  );
});
test("unverified advance is identified as requiring clarification", () => {
  const unverified = draft();
  unverified.advance!.verified = false;
  assert.equal(
    compareFeePolicies(agreement, unverified, 300000, 0)[0].preview
      ?.requiresClarification,
    true,
  );
});

test("preview rejects changes to an already recorded advance identity", () => {
  const copy = structuredClone(agreement);
  const rules = draft();
  copy.value.versions.push({
    id: 1,
    status: "ACTIVE",
    rules,
    approvals: {},
    changeRequests: [],
  });
  const changed = structuredClone(rules);
  changed.advance!.amountCents = 100;
  assert.throws(
    () => compareFeePolicies(copy, changed, 10000, 0),
    /cannot change/,
  );
});

test("a refreshed agreement invalidates an earlier fee comparison", () => {
  const review = readFileSync(
    new URL("../components/rule-impact-review.tsx", import.meta.url),
    "utf8",
  );
  assert.match(review, /agreementRevision:\s*agreement\.revision/);
  assert.match(
    review,
    /result\?\.draftRevision === revision\s*&&\s*result\.agreementRevision === agreement\.revision[\s\S]*?\? result\.choices[\s\S]*?: null/,
  );
});
