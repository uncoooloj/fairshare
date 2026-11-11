import type { Agreement } from "./model";

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
) {
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
  for (const agreement of agreements) {
    const value = agreement.value;
    const member = value.members.find((m) => m.userId === userId);
    const organizer = member?.role === "ORGANIZER";
    for (const revenue of value.revenue)
      for (const row of revenue.allocations) {
        const key = `${agreement.id}:${revenue.providerCaptureId}:${row.userId}`;
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
        key: `${agreement.id}:hold`,
        agreement,
        title: "Payment reconciliation needed",
        detail:
          "Recorded allocations remain visible; payouts are paused for review.",
      });
    const latest = value.versions.at(-1);
    if (latest?.status === "AWAITING_APPROVAL") {
      if (member && !latest.approvals[userId])
        attention.push({
          key: `${agreement.id}:approval`,
          agreement,
          title: `Review version ${latest.id}`,
          detail: "Your approval is still needed for these rules.",
        });
      const others = value.members.filter(
        (m) => m.userId !== userId && !latest.approvals[m.userId],
      );
      if (others.length)
        waiting.push({
          key: `${agreement.id}:waiting`,
          agreement,
          title: `${others.map((m) => m.displayName).join(", ")} ${others.length === 1 ? "has" : "have"} not approved`,
          detail: `Version ${latest.id} · review people and copy a reminder from the agreement.`,
        });
    }
    if (
      organizer &&
      latest?.status === "DRAFT" &&
      latest.rules.unresolvedQuestions.length
    )
      attention.push({
        key: `${agreement.id}:questions`,
        agreement,
        title: `${latest.rules.unresolvedQuestions.length} open clarification${latest.rules.unresolvedQuestions.length === 1 ? "" : "s"}`,
        detail: "Resolve the proposed rules before sending them for approval.",
      });
    for (const event of value.audit) {
      if (!Number.isFinite(Date.parse(event.at))) continue;
      const actor =
        value.members.find((m) => m.userId === event.actorId)?.displayName ||
        "A participant";
      const action = eventNames[event.type] || "recorded an agreement update";
      activity.push({
        key: `${agreement.id}:${event.sequence}`,
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
    const agreement = agreements.find((a) => a.id === payout.agreement.id);
    if (!agreement || seen.has(payout.id)) continue;
    seen.add(payout.id);
    const key = `${agreement.id}:${payout.capture_id}:${payout.user_id}`;
    const amount = allocations.get(key);
    if (payout.status === "SUCCESS" && amount === payout.amount) {
      paid += payout.amount;
      allocations.delete(key); // One verified payout per allocation, even if duplicate operation rows arrive.
    }
    if (actionStatuses.has(payout.status))
      attention.push({
        key: `payout:${payout.id}`,
        agreement,
        title: `Payout needs attention: ${agreement.value.members.find((m) => m.userId === payout.user_id)?.displayName || "participant"}`,
        detail: `Recorded provider state: ${payout.status.toLowerCase().replaceAll("_", " ")}. Check the payout before retrying.`,
      });
  }
  activity.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const moneyValid =
    Number.isSafeInteger(allocated) &&
    Number.isSafeInteger(paid) &&
    paid <= allocated;
  return {
    allocated: moneyValid ? allocated : null,
    paid: moneyValid ? paid : null,
    remaining: moneyValid ? allocated - paid : null,
    attention,
    waiting,
    activity: activity.slice(0, 8),
  };
}
