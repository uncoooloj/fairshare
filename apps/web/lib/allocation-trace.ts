import type { Agreement, Allocation, Revenue, Source } from "./model";

export interface AllocationTrace {
  captureId: string;
  recordedAt: string;
  versionId: number;
  grossCents: number;
  providerFeeCents: number;
  netCents: number;
  poolCents: number;
  recoupedCents: number;
  shareBasisPoints: number;
  roundingCents: number;
  allocation: Allocation;
  source: Source;
  advanceSource?: Source;
  held: boolean;
}

/** Project recorded history only. Never substitute today's active rules for a payment's version. */
export function allocationTrace(
  agreement: Agreement,
  captureId: string,
  userId: string,
  payoutAmount?: number,
): AllocationTrace | undefined {
  const revenue = agreement.value.revenue.find(
    (r) => r.providerCaptureId === captureId,
  );
  const version = agreement.value.versions.find(
    (v) => v.id === revenue?.versionId,
  );
  const allocation = revenue?.allocations.find((a) => a.userId === userId);
  const share = version?.rules.shares.find((s) => s.userId === userId);
  if (!revenue || !version || !allocation || !share) return;
  const amounts = [
    revenue.grossCents,
    revenue.feeCents,
    revenue.netCents,
    ...revenue.allocations.flatMap((a) => [
      a.recoupmentCents,
      a.shareCents,
      a.feeCents,
      a.totalCents,
    ]),
  ];
  if (
    amounts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    revenue.grossCents - revenue.feeCents !== revenue.netCents ||
    revenue.allocations.some(
      (a) => a.recoupmentCents + a.shareCents - a.feeCents !== a.totalCents,
    ) ||
    revenue.allocations.reduce((n, a) => n + a.totalCents, 0) !==
      revenue.netCents ||
    (payoutAmount !== undefined && payoutAmount !== allocation.totalCents)
  )
    return;
  const recoupedCents = revenue.allocations.reduce(
    (n, a) => n + a.recoupmentCents,
    0,
  );
  const poolCents = revenue.allocations.reduce((n, a) => n + a.shareCents, 0);
  if (
    !Number.isInteger(share.basisPoints) ||
    share.basisPoints < 0 ||
    share.basisPoints > 10000
  )
    return;
  const floor = Number(
    (BigInt(poolCents) * BigInt(share.basisPoints)) / BigInt(10000),
  );
  if (allocation.shareCents < floor || allocation.shareCents > floor + 1)
    return;
  return {
    captureId,
    recordedAt: revenue.at,
    versionId: version.id,
    grossCents: revenue.grossCents,
    providerFeeCents: revenue.feeCents,
    netCents: revenue.netCents,
    poolCents,
    recoupedCents,
    shareBasisPoints: share.basisPoints,
    roundingCents: allocation.shareCents - floor,
    allocation: { ...allocation },
    source: { ...version.rules.source },
    advanceSource: version.rules.advance
      ? { ...version.rules.advance.source }
      : undefined,
    held:
      agreement.value.reviewHold ||
      revenue.status === "REVIEW_REQUIRED" ||
      allocation.status === "HELD",
  };
}

export function allocationRows(agreement: Agreement) {
  return agreement.value.revenue
    .flatMap((revenue: Revenue) =>
      revenue.allocations.map((allocation) => ({
        revenue,
        allocation,
        name:
          agreement.value.members.find((m) => m.userId === allocation.userId)
            ?.displayName || "Former participant",
        trace: allocationTrace(
          agreement,
          revenue.providerCaptureId,
          allocation.userId,
        ),
      })),
    )
    .sort((a, b) => Date.parse(b.revenue.at) - Date.parse(a.revenue.at));
}
