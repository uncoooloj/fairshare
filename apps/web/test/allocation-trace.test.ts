import { test } from "node:test";
import assert from "node:assert/strict";
import { allocationRows, allocationTrace } from "../lib/allocation-trace";
import type { Agreement } from "../lib/model";
import { readFileSync } from "node:fs";
import { appSource } from "./app-source";

function agreement(): Agreement {
  const source = {
    origin: "DOCUMENT",
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
        { userId: "riley", displayName: "Riley", role: "COLLABORATOR" },
      ],
      versions: [
        {
          id: 1,
          status: "SUPERSEDED",
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
            source,
            unresolvedQuestions: [],
          },
        },
      ],
      activeVersionId: 99,
      reviewHold: false,
      recoupedByAdvance: {},
      audit: [],
      revenue: [
        {
          providerCaptureId: "capture",
          grossCents: 300000,
          feeCents: 0,
          netCents: 300000,
          versionId: 1,
          at: "2026-11-10T00:00:00Z",
          status: "ALLOCATED",
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
test("inconsistent ledger fails closed, refund hold does not erase recorded shares", () => {
  const a = agreement();
  a.value.reviewHold = true;
  assert.equal(allocationTrace(a, "capture", "riley")?.held, true);
  assert.equal(allocationRows(a).length, 3);
  a.value.revenue[0].netCents--;
  assert.equal(allocationTrace(a, "capture", "riley"), undefined);
});
test("ledger order newest first, does not invent adjustment rows or former member names", () => {
  const a = agreement();
  const next = structuredClone(a.value.revenue[0]);
  next.providerCaptureId = "new";
  next.at = "2026-11-11T00:00:00Z";
  a.value.revenue.push(next);
  const rows = allocationRows(a);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].revenue.providerCaptureId, "new");
  assert.equal(rows[1].name, "Former participant");
});
test("payout mapping joins the actual capture and recipient, no invented timestamp", () => {
  const app = appSource();
  assert.match(
    app,
    /allocationTrace\(\s*p.agreement,\s*p.capture_id,\s*p.user_id,\s*p.amount/,
  );
  assert.match(app, /AgreementTab.Allocations/);
});
test("rounding explains only the actual largest-remainder cent", () => {
  const a = agreement();
  const r = a.value.revenue[0];
  r.grossCents = r.netCents = 1;
  r.allocations.forEach((row) => {
    row.recoupmentCents = 0;
    row.shareCents = row.totalCents = row.userId === "maya" ? 1 : 0;
  });
  assert.equal(allocationTrace(a, "capture", "maya")?.roundingCents, 1);
  assert.equal(allocationTrace(a, "capture", "riley")?.roundingCents, 0);
});
test("recipient-borne fee is subtracted once, not from the split pool twice", () => {
  const a = agreement();
  const r = a.value.revenue[0];
  a.value.versions[0].rules.feePolicy = "ORGANIZER_SHARE";
  r.feeCents = 30;
  r.netCents -= 30;
  r.allocations[0].feeCents = 30;
  r.allocations[0].totalCents -= 30;
  const t = allocationTrace(a, "capture", "maya")!;
  assert.equal(t.poolCents, 100000);
  assert.equal(t.allocation.totalCents, 249970);
  assert.equal(t.allocation.feeCents, 30);
  assert.equal(t.providerFeeCents, 30);
});
