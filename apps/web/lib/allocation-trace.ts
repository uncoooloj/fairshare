import type { Agreement, Allocation, Revenue, Source, Version } from "./model";

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

const validCents = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000;
const basisPointScale = BigInt(10000);

function validSource(source: Source | undefined): source is Source {
  return (
    !!source &&
    (source.origin === "SOURCE_CLAUSE" || source.origin === "HUMAN_PROPOSAL") &&
    [source.documentId, source.clause, source.excerpt].every(
      (value) =>
        typeof value === "string" && !!value.trim() && value.length <= 10000,
    )
  );
}

function splitCents(
  total: number,
  shares: { userId: string; basisPoints: number }[],
) {
  if (!validCents(total) || !Array.isArray(shares) || !shares.length) return;
  const seen = new Set<string>();
  let totalBasisPoints = 0;
  for (const share of shares) {
    if (
      !share ||
      typeof share.userId !== "string" ||
      !share.userId.trim() ||
      share.userId.length > 10000 ||
      seen.has(share.userId) ||
      !Number.isInteger(share.basisPoints) ||
      share.basisPoints < 0 ||
      share.basisPoints > 10000
    )
      return;
    seen.add(share.userId);
    totalBasisPoints += share.basisPoints;
  }
  if (totalBasisPoints !== 10000) return;

  const rows = shares.map((share) => ({
    ...share,
    cents: Number(
      (BigInt(total) * BigInt(share.basisPoints)) / basisPointScale,
    ),
    remainder: (BigInt(total) * BigInt(share.basisPoints)) % basisPointScale,
  }));
  let left = total - rows.reduce((sum, row) => sum + row.cents, 0);
  rows.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.userId < b.userId) return -1;
    if (a.userId > b.userId) return 1;
    return 0;
  });
  for (const row of rows)
    if (left > 0) {
      row.cents++;
      left--;
    }
  return new Map(rows.map((row) => [row.userId, row.cents]));
}

interface ReplayedRevenue {
  poolCents: number;
  recoupedCents: number;
}

function replayRevenue(
  revenue: Revenue,
  version: Version,
  recoupedByAdvance: Map<string, number>,
  advanceDefinitions: Map<string, { recipientId: string; amountCents: number }>,
): ReplayedRevenue | undefined {
  const rules = version.rules;
  if (
    !rules ||
    rules.currency !== "USD" ||
    revenue.currency !== "USD" ||
    (version.status !== "ACTIVE" && version.status !== "SUPERSEDED") ||
    (revenue.status !== "CONFIRMED" && revenue.status !== "REVIEW_REQUIRED") ||
    !validSource(rules.source) ||
    !Array.isArray(rules.shares) ||
    !Array.isArray(revenue.allocations) ||
    ![revenue.grossCents, revenue.feeCents, revenue.netCents].every(
      validCents,
    ) ||
    revenue.grossCents - revenue.feeCents !== revenue.netCents
  )
    return;

  let base: number;
  let feeBearerId: string | undefined;
  if (rules.feePolicy === "BEFORE_SPLIT") {
    base = revenue.netCents;
  } else if (rules.feePolicy === "ORGANIZER_SHARE") {
    feeBearerId = rules.feeBearerId;
    if (
      typeof feeBearerId !== "string" ||
      rules.shares.filter((share) => share?.userId === feeBearerId).length !== 1
    )
      return;
    base = revenue.grossCents;
  } else {
    return;
  }

  let recoupment = 0;
  const advance = rules.advance;
  if (advance !== undefined) {
    if (
      !advance ||
      typeof advance.id !== "string" ||
      !advance.id.trim() ||
      advance.id.length > 10000 ||
      typeof advance.recipientId !== "string" ||
      rules.shares.filter((share) => share?.userId === advance.recipientId)
        .length !== 1 ||
      !validCents(advance.amountCents) ||
      advance.verified !== true ||
      !validSource(advance.source)
    )
      return;
    const definition = advanceDefinitions.get(advance.id);
    if (
      definition &&
      (definition.recipientId !== advance.recipientId ||
        definition.amountCents !== advance.amountCents)
    )
      return;
    advanceDefinitions.set(advance.id, {
      recipientId: advance.recipientId,
      amountCents: advance.amountCents,
    });
    const priorRecouped = recoupedByAdvance.get(advance.id) ?? 0;
    recoupment = Math.min(
      base,
      Math.max(0, advance.amountCents - priorRecouped),
    );
  }

  const poolCents = base - recoupment;
  const expectedShares = splitCents(poolCents, rules.shares);
  if (!expectedShares || revenue.allocations.length !== rules.shares.length)
    return;

  const seenAllocations = new Set<string>();
  let recordedTotal = 0;
  for (const allocation of revenue.allocations) {
    if (
      !allocation ||
      typeof allocation.userId !== "string" ||
      seenAllocations.has(allocation.userId) ||
      (allocation.status !== "ALLOCATED" && allocation.status !== "HELD") ||
      ![
        allocation.recoupmentCents,
        allocation.shareCents,
        allocation.feeCents,
        allocation.totalCents,
        allocation.offsetCents ?? 0,
        allocation.creditCents ?? 0,
      ].every(validCents)
    )
      return;
    seenAllocations.add(allocation.userId);
    const expectedShare = expectedShares.get(allocation.userId);
    if (expectedShare === undefined) return;
    const expectedRecoupment =
      advance?.recipientId === allocation.userId ? recoupment : 0;
    const expectedFee =
      feeBearerId === allocation.userId ? revenue.feeCents : 0;
    const expectedTotal =
      expectedRecoupment +
      expectedShare -
      expectedFee -
      (allocation.offsetCents ?? 0) +
      (allocation.creditCents ?? 0);
    if (
      expectedTotal < 0 ||
      allocation.recoupmentCents !== expectedRecoupment ||
      allocation.shareCents !== expectedShare ||
      allocation.feeCents !== expectedFee ||
      allocation.totalCents !== expectedTotal
    )
      return;
    recordedTotal +=
      allocation.totalCents +
      (allocation.offsetCents ?? 0) -
      (allocation.creditCents ?? 0);
  }
  if (
    !Number.isSafeInteger(recordedTotal) ||
    recordedTotal !== revenue.netCents
  )
    return;

  if (advance)
    recoupedByAdvance.set(
      advance.id,
      (recoupedByAdvance.get(advance.id) ?? 0) + recoupment,
    );
  return { poolCents, recoupedCents: recoupment };
}

/** Project recorded history only. Never substitute today's active rules for a payment's version. */
export function allocationTrace(
  agreement: Agreement,
  captureId: string,
  userId: string,
  payoutAmount?: number,
): AllocationTrace | undefined {
  if (
    !Array.isArray(agreement.value.revenue) ||
    !Array.isArray(agreement.value.versions)
  )
    return;
  const targetIndexes = agreement.value.revenue.flatMap((revenue, index) =>
    revenue?.providerCaptureId === captureId ? [index] : [],
  );
  if (targetIndexes.length !== 1) return;
  const targetIndex = targetIndexes[0];
  const recoupedByAdvance = new Map<string, number>();
  const advanceDefinitions = new Map<
    string,
    { recipientId: string; amountCents: number }
  >();
  let replayedTarget: ReplayedRevenue | undefined;
  let targetVersion: Version | undefined;

  for (let index = 0; index <= targetIndex; index++) {
    const revenue = agreement.value.revenue[index];
    const versions = agreement.value.versions.filter(
      (version) => version?.id === revenue?.versionId,
    );
    if (!revenue || versions.length !== 1) return;
    const replayed = replayRevenue(
      revenue,
      versions[0],
      recoupedByAdvance,
      advanceDefinitions,
    );
    if (!replayed) return;
    if (index === targetIndex) {
      replayedTarget = replayed;
      targetVersion = versions[0];
    }
  }

  if (!replayedTarget || !targetVersion) return;
  const revenue = agreement.value.revenue[targetIndex];
  const allocations = revenue.allocations.filter(
    (allocation) => allocation.userId === userId,
  );
  const shares = targetVersion.rules.shares.filter(
    (share) => share.userId === userId,
  );
  if (allocations.length !== 1 || shares.length !== 1) return;
  const allocation = allocations[0];
  const share = shares[0];
  if (payoutAmount !== undefined && payoutAmount !== allocation.totalCents)
    return;

  return {
    captureId,
    recordedAt: revenue.at,
    versionId: targetVersion.id,
    grossCents: revenue.grossCents,
    providerFeeCents: revenue.feeCents,
    netCents: revenue.netCents,
    poolCents: replayedTarget.poolCents,
    recoupedCents: replayedTarget.recoupedCents,
    shareBasisPoints: share.basisPoints,
    roundingCents:
      allocation.shareCents -
      Number(
        (BigInt(replayedTarget.poolCents) * BigInt(share.basisPoints)) /
          basisPointScale,
      ),
    allocation: { ...allocation },
    source: { ...targetVersion.rules.source },
    advanceSource: targetVersion.rules.advance
      ? { ...targetVersion.rules.advance.source }
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
