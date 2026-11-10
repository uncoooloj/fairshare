/** Deferred read-only analytics foundation. Not mounted as an API or an AG Studio tool.
 * Caller must obtain this aggregate through current tenant/session authorization on EVERY call.
 * Actor identity must come from that session, never from model arguments. */
import {
  type Collaboration,
  AllocationStatus,
  RevenueStatus,
} from "./index.ts";
export enum AnalyticsAction {
  EXPLAIN_ALLOCATION = "EXPLAIN_ALLOCATION",
  LIST_HELD_REVENUE = "LIST_HELD_REVENUE",
}
export interface AllocationExplanation {
  kind: "recorded-allocation";
  agreementId: string;
  captureId: string;
  versionId: number;
  currency: "USD";
  grossCents: number;
  providerFeeCents: number;
  netCents: number;
  recipientId: string;
  shareBasisPoints: number;
  recoupmentCents: number;
  shareCents: number;
  recipientFeeCents: number;
  allocatedCents: number;
  held: boolean;
  payoutStatus: "NOT_INCLUDED";
  source: {
    documentId: string;
    clause: string;
    excerpt: string;
    origin: string;
  };
}
function requireMember(c: Collaboration, actorId: string) {
  if (!c.members.some((m) => m.userId === actorId))
    throw new Error("FORBIDDEN");
}
function validCents(...values: number[]) {
  if (values.some((v) => !Number.isSafeInteger(v) || v < 0))
    throw new Error("INVALID_LEDGER");
}
/** Returns recorded historical facts, not newly generated arithmetic or current-version shares. */
export function explainRecordedAllocation(
  c: Collaboration,
  actorId: string,
  captureId: string,
  recipientId: string,
): AllocationExplanation {
  requireMember(c, actorId);
  const revenue = c.revenue.find((r) => r.providerCaptureId === captureId);
  if (!revenue) throw new Error("UNKNOWN_REVENUE");
  const version = c.versions.find((v) => v.id === revenue.versionId);
  const allocation = revenue.allocations.find((a) => a.userId === recipientId);
  const share = version?.rules.shares.find((s) => s.userId === recipientId);
  if (!version || !allocation || !share) throw new Error("INCOMPLETE_LEDGER");
  validCents(
    revenue.grossCents,
    revenue.feeCents,
    revenue.netCents,
    allocation.recoupmentCents,
    allocation.shareCents,
    allocation.feeCents,
    allocation.totalCents,
  );
  if (
    revenue.grossCents - revenue.feeCents !== revenue.netCents ||
    allocation.recoupmentCents + allocation.shareCents - allocation.feeCents !==
      allocation.totalCents ||
    revenue.allocations.reduce((sum, row) => sum + row.totalCents, 0) !==
      revenue.netCents
  )
    throw new Error("INVALID_LEDGER");
  return structuredClone({
    kind: "recorded-allocation",
    agreementId: c.id,
    captureId,
    versionId: version.id,
    currency: revenue.currency,
    grossCents: revenue.grossCents,
    providerFeeCents: revenue.feeCents,
    netCents: revenue.netCents,
    recipientId,
    shareBasisPoints: share.basisPoints,
    recoupmentCents: allocation.recoupmentCents,
    shareCents: allocation.shareCents,
    recipientFeeCents: allocation.feeCents,
    allocatedCents: allocation.totalCents,
    held:
      c.reviewHold ||
      revenue.status === RevenueStatus.REVIEW_REQUIRED ||
      allocation.status === AllocationStatus.HELD,
    payoutStatus: "NOT_INCLUDED",
    source: version.rules.source,
  });
}
export function listHeldRevenue(c: Collaboration, actorId: string) {
  requireMember(c, actorId);
  return c.revenue
    .filter(
      (r) =>
        c.reviewHold ||
        r.status === RevenueStatus.REVIEW_REQUIRED ||
        r.allocations.some((a) => a.status === AllocationStatus.HELD),
    )
    .map((r) => ({
      agreementId: c.id,
      captureId: r.providerCaptureId,
      versionId: r.versionId,
      currency: r.currency,
      netCents: r.netCents,
      reason: c.reviewHold
        ? "Agreement requires reconciliation"
        : "Payment requires reconciliation",
    }));
}
/** Deliberately no payment, approval, mutation, arbitrary SQL, or arbitrary URL capability. */
export function runReadOnlyAnalytics(
  c: Collaboration,
  sessionActorId: string,
  input: unknown,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("INVALID_QUERY");
  const q = input as Record<string, unknown>;
  if (
    q.action === AnalyticsAction.EXPLAIN_ALLOCATION &&
    Object.keys(q).every((k) =>
      ["action", "captureId", "recipientId"].includes(k),
    ) &&
    typeof q.captureId === "string" &&
    typeof q.recipientId === "string"
  )
    return explainRecordedAllocation(
      c,
      sessionActorId,
      q.captureId,
      q.recipientId,
    );
  if (
    q.action === AnalyticsAction.LIST_HELD_REVENUE &&
    Object.keys(q).length === 1
  )
    return listHeldRevenue(c, sessionActorId);
  throw new Error("UNSUPPORTED_QUERY");
}
