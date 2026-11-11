import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { allocationRows, allocationTrace } from "../lib/allocation-trace";
import type { Agreement, Revenue } from "../lib/model";
import { appSource } from "./app-source";

function agreement(): Agreement {
  const source = {
    origin: "SOURCE_CLAUSE",
    documentId: "doc1",
    clause: "4.2",
    excerpt: "Split 50/30/20 after recoupment.",
  };
  return {
    workspaceId: "w",
    id: "a",
    revision: 1,
    value: {
      name: "Sessions",
      members: [
        { userId: "maya", displayName: "Maya", role: "ORGANIZER" },
        { userId: "jordan", displayName: "Jordan", role: "COLLABORATOR" },
        { userId: "riley", displayName: "Riley", role: "COLLABORATOR" },
      ],
      versions: [
        {
          id: 1,
          status: "ACTIVE",
          approvals: {},
          changeRequests: [],
          rules: {
            currency: "USD",
            shares: [
              { userId: "maya", basisPoints: 5000 },
              { userId: "jordan", basisPoints: 3000 },
              { userId: "riley", basisPoints: 2000 },
            ],
            feePolicy: "BEFORE_SPLIT",
            advance: {
              id: "advance",
              recipientId: "maya",
              amountCents: 200000,
              verified: true,
              source,
            },
            source,
            unresolvedQuestions: [],
          },
        },
      ],
      activeVersionId: 1,
      reviewHold: false,
      recoupedByAdvance: { advance: 200000 },
      audit: [],
      revenue: [
        {
          providerCaptureId: "capture",
          currency: "USD",
          grossCents: 300000,
          feeCents: 0,
          netCents: 300000,
          versionId: 1,
          at: "2026-11-10T00:00:00Z",
          status: "CONFIRMED",
          allocations: [
            {
              userId: "maya",
              recoupmentCents: 200000,
              shareCents: 50000,
              feeCents: 0,
              totalCents: 250000,
              status: "ALLOCATED",
            },
            {
              userId: "jordan",
              recoupmentCents: 0,
              shareCents: 30000,
              feeCents: 0,
              totalCents: 30000,
              status: "ALLOCATED",
            },
            {
              userId: "riley",
              recoupmentCents: 0,
              shareCents: 20000,
              feeCents: 0,
              totalCents: 20000,
              status: "ALLOCATED",
            },
          ],
        },
      ],
    },
  };
}

function setAllocations(
  revenue: Revenue,
  amounts: Record<
    string,
    { recoupmentCents: number; shareCents: number; feeCents?: number }
  >,
) {
  for (const allocation of revenue.allocations) {
    const amount = amounts[allocation.userId];
    assert.ok(amount, `missing test allocation for ${allocation.userId}`);
    allocation.recoupmentCents = amount.recoupmentCents;
    allocation.shareCents = amount.shareCents;
    allocation.feeCents = amount.feeCents ?? 0;
    allocation.totalCents =
      allocation.recoupmentCents + allocation.shareCents - allocation.feeCents;
  }
}

function twoCaptureAgreement() {
  const a = agreement();
  const target = a.value.revenue[0];
  const first = structuredClone(target);
  first.providerCaptureId = "first";
  first.at = "2026-11-09T00:00:00Z";
  first.grossCents = first.netCents = 100000;
  setAllocations(first, {
    maya: { recoupmentCents: 100000, shareCents: 0 },
    jordan: { recoupmentCents: 0, shareCents: 0 },
    riley: { recoupmentCents: 0, shareCents: 0 },
  });
  target.grossCents = target.netCents = 200000;
  setAllocations(target, {
    maya: { recoupmentCents: 100000, shareCents: 50000 },
    jordan: { recoupmentCents: 0, shareCents: 30000 },
    riley: { recoupmentCents: 0, shareCents: 20000 },
  });
  a.value.revenue = [first, target];
  return a;
}

test("trace uses captured historical version, exact recoupment and original clause", () => {
  const a = agreement();
  const before = JSON.stringify(a);
  const t = allocationTrace(a, "capture", "riley", 20000)!;
  assert.equal(t.versionId, 1);
  assert.equal(t.poolCents, 100000);
  assert.equal(t.recoupedCents, 200000);
  assert.equal(t.allocation.totalCents, 20000);
  assert.equal(t.source.clause, "4.2");
  assert.equal(t.roundingCents, 0);
  assert.equal(JSON.stringify(a), before);
});

test("missing version, capture, recipient or mismatched payout never generates a trace", () => {
  const a = agreement();
  assert.equal(allocationTrace(a, "missing", "riley"), undefined);
  assert.equal(allocationTrace(a, "capture", "missing"), undefined);
  assert.equal(allocationTrace(a, "capture", "riley", 1), undefined);
  a.value.versions = [];
  assert.equal(allocationTrace(a, "capture", "riley"), undefined);
});

test("inconsistent money or allocation user sets fail closed", () => {
  const inconsistentMoney = agreement();
  inconsistentMoney.value.revenue[0].netCents--;
  assert.equal(
    allocationTrace(inconsistentMoney, "capture", "riley"),
    undefined,
  );

  const duplicateRecipient = agreement();
  duplicateRecipient.value.revenue[0].allocations[1].userId = "maya";
  assert.equal(
    allocationTrace(duplicateRecipient, "capture", "riley"),
    undefined,
  );
});

test("refund hold does not erase recorded shares", () => {
  const a = agreement();
  a.value.reviewHold = true;
  a.value.revenue[0].status = "REVIEW_REQUIRED";
  a.value.revenue[0].allocations.forEach(
    (allocation) => (allocation.status = "HELD"),
  );
  assert.equal(allocationTrace(a, "capture", "riley")?.held, true);
  assert.equal(allocationRows(a).length, 3);
});

test("ledger order is newest first and former participant names are explicit", () => {
  const a = agreement();
  const next = structuredClone(a.value.revenue[0]);
  next.providerCaptureId = "new";
  next.at = "2026-11-11T00:00:00Z";
  setAllocations(next, {
    maya: { recoupmentCents: 0, shareCents: 150000 },
    jordan: { recoupmentCents: 0, shareCents: 90000 },
    riley: { recoupmentCents: 0, shareCents: 60000 },
  });
  a.value.revenue.push(next);
  a.value.members = a.value.members.filter(
    (member) => member.userId !== "jordan",
  );
  const rows = allocationRows(a);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].revenue.providerCaptureId, "new");
  assert.equal(rows[1].name, "Former participant");
  assert.ok(rows.every((row) => row.trace));
});

test("payout mapping joins the actual capture, recipient and amount", () => {
  const app = appSource();
  assert.match(
    app,
    /allocationTrace\(\s*p.agreement,\s*p.capture_id,\s*p.user_id,\s*p.amount/,
  );
  const allocations = readFileSync(
    new URL("../components/agreement-allocations.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    allocations,
    /allocationTrace\(\s*agreement,\s*row\.revenue\.providerCaptureId,\s*row\.allocation\.userId,\s*payout\?\.amount,\s*\)/,
  );
  assert.match(app, /AgreementTab.Allocations/);
});

test("rounding uses the domain user-ID tie break and rejects the wrong recipient", () => {
  const a = agreement();
  const rules = a.value.versions[0].rules;
  delete rules.advance;
  rules.shares = [
    { userId: "Z", basisPoints: 5000 },
    { userId: "a", basisPoints: 5000 },
  ];
  a.value.members = [
    { userId: "Z", displayName: "Z", role: "ORGANIZER" },
    { userId: "a", displayName: "A", role: "COLLABORATOR" },
  ];
  const revenue = a.value.revenue[0];
  revenue.grossCents = revenue.netCents = 1;
  revenue.allocations = [
    {
      userId: "Z",
      recoupmentCents: 0,
      shareCents: 1,
      feeCents: 0,
      totalCents: 1,
      status: "ALLOCATED",
    },
    {
      userId: "a",
      recoupmentCents: 0,
      shareCents: 0,
      feeCents: 0,
      totalCents: 0,
      status: "ALLOCATED",
    },
  ];
  assert.equal(allocationTrace(a, "capture", "Z")?.roundingCents, 1);

  revenue.allocations[0].shareCents = revenue.allocations[0].totalCents = 0;
  revenue.allocations[1].shareCents = revenue.allocations[1].totalCents = 1;
  assert.equal(allocationTrace(a, "capture", "Z"), undefined);
});

test("fee policy and bearer reconstruct the exact recorded allocation", () => {
  const beforeSplit = agreement();
  const beforeSplitRevenue = beforeSplit.value.revenue[0];
  beforeSplitRevenue.feeCents = 30;
  beforeSplitRevenue.netCents -= 30;
  setAllocations(beforeSplitRevenue, {
    maya: { recoupmentCents: 200000, shareCents: 49985 },
    jordan: { recoupmentCents: 0, shareCents: 29991 },
    riley: { recoupmentCents: 0, shareCents: 19994 },
  });
  const beforeSplitTrace = allocationTrace(beforeSplit, "capture", "maya")!;
  assert.equal(beforeSplitTrace.poolCents, 99970);
  assert.equal(beforeSplitTrace.allocation.feeCents, 0);
  assert.equal(beforeSplitTrace.providerFeeCents, 30);

  const a = agreement();
  const rules = a.value.versions[0].rules;
  const revenue = a.value.revenue[0];
  rules.feePolicy = "ORGANIZER_SHARE";
  rules.feeBearerId = "maya";
  revenue.feeCents = 30;
  revenue.netCents -= 30;
  revenue.allocations[0].feeCents = 30;
  revenue.allocations[0].totalCents -= 30;
  const trace = allocationTrace(a, "capture", "maya")!;
  assert.equal(trace.poolCents, 100000);
  assert.equal(trace.allocation.totalCents, 249970);
  assert.equal(trace.providerFeeCents, 30);

  const wrongBearer = structuredClone(a);
  wrongBearer.value.versions[0].rules.feeBearerId = "missing";
  assert.equal(allocationTrace(wrongBearer, "capture", "maya"), undefined);

  const wrongFeeRow = structuredClone(a);
  wrongFeeRow.value.revenue[0].allocations[0].feeCents = 0;
  wrongFeeRow.value.revenue[0].allocations[0].totalCents += 30;
  wrongFeeRow.value.revenue[0].allocations[2].feeCents = 30;
  wrongFeeRow.value.revenue[0].allocations[2].totalCents -= 30;
  assert.equal(allocationTrace(wrongFeeRow, "capture", "maya"), undefined);

  const wrongPolicy = structuredClone(a);
  wrongPolicy.value.versions[0].rules.feePolicy = "BEFORE_SPLIT";
  assert.equal(allocationTrace(wrongPolicy, "capture", "maya"), undefined);

  const unknownPolicy = agreement();
  unknownPolicy.value.versions[0].rules.feePolicy = "UNKNOWN";
  assert.equal(allocationTrace(unknownPolicy, "capture", "maya"), undefined);
});

test("recoupment requires an advance and its recorded recipient", () => {
  const missingAdvance = agreement();
  delete missingAdvance.value.versions[0].rules.advance;
  assert.equal(allocationTrace(missingAdvance, "capture", "riley"), undefined);

  const wrongRecipient = agreement();
  setAllocations(wrongRecipient.value.revenue[0], {
    maya: { recoupmentCents: 0, shareCents: 50000 },
    jordan: { recoupmentCents: 200000, shareCents: 30000 },
    riley: { recoupmentCents: 0, shareCents: 20000 },
  });
  assert.equal(allocationTrace(wrongRecipient, "capture", "riley"), undefined);
});

test("advance history is replayed sequentially instead of accepting shifted recoupment", () => {
  const valid = twoCaptureAgreement();
  assert.equal(
    allocationTrace(valid, "capture", "riley")?.recoupedCents,
    100000,
  );

  const shifted = structuredClone(valid);
  setAllocations(shifted.value.revenue[0], {
    maya: { recoupmentCents: 50000, shareCents: 25000 },
    jordan: { recoupmentCents: 0, shareCents: 15000 },
    riley: { recoupmentCents: 0, shareCents: 10000 },
  });
  setAllocations(shifted.value.revenue[1], {
    maya: { recoupmentCents: 150000, shareCents: 25000 },
    jordan: { recoupmentCents: 0, shareCents: 15000 },
    riley: { recoupmentCents: 0, shareCents: 10000 },
  });
  assert.equal(allocationTrace(shifted, "capture", "riley"), undefined);

  const missingHistory = structuredClone(valid);
  missingHistory.value.revenue.shift();
  assert.equal(allocationTrace(missingHistory, "capture", "riley"), undefined);
});

test("an advance ID cannot change recipient across historical versions", () => {
  const a = twoCaptureAgreement();
  const firstVersion = a.value.versions[0];
  firstVersion.status = "SUPERSEDED";
  const changedVersion = structuredClone(firstVersion);
  changedVersion.id = 2;
  changedVersion.status = "ACTIVE";
  changedVersion.rules.advance!.recipientId = "jordan";
  a.value.versions.push(changedVersion);
  a.value.activeVersionId = 2;
  const target = a.value.revenue[1];
  target.versionId = 2;
  target.grossCents = target.netCents = 100000;
  setAllocations(target, {
    maya: { recoupmentCents: 0, shareCents: 0 },
    jordan: { recoupmentCents: 100000, shareCents: 0 },
    riley: { recoupmentCents: 0, shareCents: 0 },
  });
  assert.equal(allocationTrace(a, "capture", "riley"), undefined);
});

test("invalid persisted shares fail closed without throwing", () => {
  const mutations: Array<(a: Agreement) => void> = [
    (a) => {
      a.value.versions[0].rules.shares = undefined as never;
    },
    (a) => {
      a.value.versions[0].rules.shares = [];
    },
    (a) => {
      a.value.versions[0].rules.shares[1].userId = "maya";
    },
    (a) => {
      a.value.versions[0].rules.shares[0].basisPoints = 5000.5;
    },
    (a) => {
      a.value.versions[0].rules.shares[0].basisPoints = 10001;
    },
    (a) => {
      a.value.versions[0].rules.shares[0].basisPoints = 4999;
    },
  ];
  for (const mutate of mutations) {
    const a = agreement();
    mutate(a);
    assert.doesNotThrow(() => allocationTrace(a, "capture", "riley"));
    assert.equal(allocationTrace(a, "capture", "riley"), undefined);
  }
});

test("invalid source and status values fail closed", () => {
  const badSource = agreement();
  badSource.value.versions[0].rules.source.origin = "DOCUMENT";
  assert.equal(allocationTrace(badSource, "capture", "riley"), undefined);

  const badRevenueStatus = agreement();
  badRevenueStatus.value.revenue[0].status = "ALLOCATED";
  assert.equal(
    allocationTrace(badRevenueStatus, "capture", "riley"),
    undefined,
  );

  const badAllocationStatus = agreement();
  badAllocationStatus.value.revenue[0].allocations[0].status = "PAID";
  assert.equal(
    allocationTrace(badAllocationStatus, "capture", "riley"),
    undefined,
  );

  const badCurrency = agreement();
  badCurrency.value.revenue[0].currency = "EUR" as "USD";
  assert.equal(allocationTrace(badCurrency, "capture", "riley"), undefined);
});
