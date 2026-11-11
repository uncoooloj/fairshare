import type { Agreement } from "./model";
import { contractReviewState } from "./contract-review";

export interface OverviewPayout {
  id: string;
  capture_id: string;
  user_id: string;
  amount: number;
  status: string;
  agreement: Agreement;
}
export interface AttentionItem {
  key: string;
  agreement: Agreement;
  title: string;
  detail: string;
}
const actionStatuses = new Set([
  "FAILED",
  "DENIED",
  "BLOCKED",
  "HELD",
  "ONHOLD",
  "UNCLAIMED",
  "OUTCOME_UNKNOWN",
  "REVERSED",
  "REFUNDED",
  "RETURNED",
]);
const eventNames: Record<string, string> = {
  CREATED: "created the agreement",
  VERSION_PROPOSED: "proposed new rules",
  SENT_FOR_REVIEW: "sent rules for review",
  APPROVED: "approved rules",
  CHANGE_REQUESTED: "requested changes",
  ACTIVATED: "activated approved rules",
  REVENUE_ALLOCATED: "Payment allocated",
  PAYMENT_HELD: "Payment placed on hold",
};

/** Uses only currently authorized aggregates. All-time because payout records have no timestamps. */
export function overviewSummary(
  agreements: Agreement[],
  payouts: OverviewPayout[],
  userId: string,
  payoutsComplete = true,
) {
  const identity = (a: Agreement) => JSON.stringify([a.workspaceId, a.id]);
  const authorized = [
    ...new Map(
      agreements
        .filter((a) => a.value.members.some((m) => m.userId === userId))
        .map((a) => [identity(a), a]),
    ).values(),
  ];
  const allocationKey = (a: Agreement, capture: string, recipient: string) =>
    JSON.stringify([a.workspaceId, a.id, capture, recipient]);
  const managed = authorized.filter((a) =>
    a.value.members.some((m) => m.userId === userId && m.role === "ORGANIZER"),
  );
  const scope =
    managed.length === 0
      ? "personal"
      : managed.length === authorized.length
        ? "managed"
        : "mixed";
  let allocated = 0;
  let paid = 0;
  const seen = new Set<string>();
  const allocations = new Map<string, number>();
  const attention: AttentionItem[] = [];
  const waiting: AttentionItem[] = [];
  const activity: {
    key: string;
    agreement: Agreement;
    at: string;
    text: string;
  }[] = [];
  for (const agreement of authorized) {
    const value = agreement.value;
    const member = value.members.find((m) => m.userId === userId);
    const organizer = member?.role === "ORGANIZER";
    for (const revenue of value.revenue)
      for (const row of revenue.allocations) {
        if (!organizer && row.userId !== userId) continue;
        const key = allocationKey(
          agreement,
          revenue.providerCaptureId,
          row.userId,
        );
        if (
          !allocations.has(key) &&
          Number.isSafeInteger(row.totalCents) &&
          row.totalCents >= 0
        ) {
          allocations.set(key, row.totalCents);
          allocated += row.totalCents;
        }
      }
    if (value.reviewHold)
      attention.push({
        key: `${identity(agreement)}:hold`,
        agreement,
        title: "Payment reconciliation needed",
        detail:
          "Recorded allocations remain visible; payouts are paused for review.",
      });
    const latest = value.versions.at(-1);
    if (latest) {
      const review = contractReviewState(agreement, latest, userId);
      if (latest.status === "DRAFT" && member && review.blockers.length)
        attention.push({
          key: `${agreement.id}:review-blockers`,
          agreement,
          title: "Clarify rules before review",
          detail: review.blockers.join(" "),
        });
      else if (review.canSend)
        attention.push({
          key: `${agreement.id}:send-review`,
          agreement,
          title: `Send version ${latest.id} for review`,
          detail:
            "All required clarifications are resolved. Participants still need to approve before activation.",
        });
      if (review.canActivate)
        attention.push({
          key: `${agreement.id}:activate`,
          agreement,
          title: `Activate version ${latest.id}`,
          detail:
            "Everyone approved this exact version. Activation is still required before it governs payments.",
        });
      else if (review.canApprove)
        attention.push({
          key: `${identity(agreement)}:approval`,
          agreement,
          title: `Review version ${latest.id}`,
          detail: "Your approval is still needed for these rules.",
        });
      const others =
        latest.status === "AWAITING_APPROVAL"
          ? value.members.filter(
              (m) => m.userId !== userId && !latest.approvals[m.userId],
            )
          : [];
      if (others.length)
        waiting.push({
          key: `${identity(agreement)}:waiting`,
          agreement,
          title: `${others.map((m) => m.displayName).join(", ")} ${others.length === 1 ? "has" : "have"} not approved`,
          detail: `Version ${latest.id} · review people and copy a reminder from the agreement.`,
        });
      else if (
        latest.status === "AWAITING_APPROVAL" &&
        review.allApproved &&
        member?.role !== "ORGANIZER"
      )
        waiting.push({
          key: `${agreement.id}:waiting-activation`,
          agreement,
          title: `Waiting for organizer to activate version ${latest.id}`,
          detail:
            "Everyone approved this exact version. It does not govern payments until the organizer activates it.",
        });
    }

    for (const event of value.audit) {
      if (!Number.isFinite(Date.parse(event.at))) continue;
      const actor =
        value.members.find((m) => m.userId === event.actorId)?.displayName ||
        "A participant";
      const action = eventNames[event.type] || "recorded an agreement update";
      activity.push({
        key: `${identity(agreement)}:${event.sequence}`,
        agreement,
        at: event.at,
        text:
          event.actorId === "provider"
            ? action
            : `${event.actorId === userId ? "You" : actor} ${action}`,
      });
    }
  }
  for (const payout of payouts) {
    const agreement = authorized.find(
      (a) => identity(a) === identity(payout.agreement),
    );
    if (!agreement) continue;
    const organizer = agreement.value.members.some(
      (m) => m.userId === userId && m.role === "ORGANIZER",
    );
    if (!organizer && payout.user_id !== userId) continue;
    const operationKey = JSON.stringify([identity(agreement), payout.id]);
    if (seen.has(operationKey)) continue;
    seen.add(operationKey);
    const key = allocationKey(agreement, payout.capture_id, payout.user_id);
    const amount = allocations.get(key);
    if (payout.status === "SUCCESS" && amount === payout.amount) {
      paid += payout.amount;
      allocations.delete(key); // One verified payout per allocation, even if duplicate operation rows arrive.
    }
    if (actionStatuses.has(payout.status))
      attention.push({
        key: `payout:${operationKey}`,
        agreement,
        title: `Payout needs attention: ${agreement.value.members.find((m) => m.userId === payout.user_id)?.displayName || "participant"}`,
        detail: `Recorded provider state: ${payout.status.toLowerCase().replaceAll("_", " ")}. Check the payout before retrying.`,
      });
  }
  activity.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const moneyValid =
    payoutsComplete &&
    Number.isSafeInteger(allocated) &&
    Number.isSafeInteger(paid) &&
    paid <= allocated;
  return {
    scope,
    allocated: moneyValid ? allocated : null,
    paid: moneyValid ? paid : null,
    remaining: moneyValid ? allocated - paid : null,
    attention,
    waiting,
    activity: activity.slice(0, 8),
  };
}
