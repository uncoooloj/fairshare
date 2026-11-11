import type { Agreement, Rules } from "./model";
import { contractReviewState } from "./contract-review";
import { formatMoneyHeadline } from "./preferences";

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
  "AUTO_HELD",
  "UNCLAIMED",
  "WAITING_RECIPIENT",
  "OUTCOME_UNKNOWN",
  "REVERSED",
  "REFUNDED",
  "RETURNED",
]);
const eventNames: Record<string, string> = {
  CREATED: "created the agreement",
  VERSION_PROPOSED: "suggested a split",
  SENT_FOR_REVIEW: "sent the split for approval",
  APPROVED: "approved the split",
  CHANGE_REQUESTED: "asked for a change",
  ACTIVATED: "switched on the split",
  ADVANCE_CONFIRMED: "confirmed the advance was paid",
  REVENUE_ALLOCATED: "Payment split",
  PAYMENT_HELD: "Payment paused for a check",
  PERSON_ADDED: "added someone to the agreement",
  PERSON_REMOVED: "removed someone from the agreement",
  PERSON_JOINED: "joined the agreement",
  INVITE_REISSUED: "sent a new invite link",
  ORGANIZER_HANDOVER_OFFERED: "asked someone to take over organizing",
  ORGANIZER_HANDOVER_CANCELLED: "cancelled the organizing request",
  ORGANIZER_HANDOVER_DECLINED: "said no to organizing",
  ORGANIZER_HANDED_OVER: "took over organizing",
};

/** Events the system records on its own: no actor name in front. */
const systemEvents = new Set(["REVENUE_ALLOCATED", "PAYMENT_HELD"]);

/** One activity row as a plain sentence: "Jordan approved the split". */
export function activitySentence(
  agreement: Agreement,
  event: { type: string; actorId: string; details?: unknown },
  userId: string,
) {
  const action = eventNames[event.type] || "updated the agreement";
  if (event.actorId === "provider" || systemEvents.has(event.type))
    return action.replace(/^./, (c) => c.toUpperCase());
  if (
    event.type === "ACTIVATED" &&
    (event.details as { automatic?: boolean } | undefined)?.automatic
  )
    return "Everyone approved. The split switched on.";
  const actor =
    event.actorId === userId
      ? "You"
      : agreement.value.members
          .find((m) => m.userId === event.actorId)
          ?.displayName.split(/\s+/)[0] || "Someone";
  return `${actor} ${action}`;
}

/** "Maya, Jordan and Riley" */
function list(items: string[]) {
  return items.length <= 1
    ? items[0] || ""
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The split in plain sentences, written from the viewer's side. */
export function splitSentences(
  agreement: Agreement,
  rules: Rules,
  userId: string,
): string[] {
  const name = (id: string) =>
    id === userId
      ? "you"
      : agreement.value.members
          .find((m) => m.userId === id)
          ?.displayName.split(/\s+/)[0] || "a former member";
  const pct = (bp: number) => `${bp / 100}%`;
  const out: string[] = [];
  const advance = rules.advance;
  const advanceTo = advance ? name(advance.recipientId) : "";
  const mine = rules.shares.find((s) => s.userId === userId);
  const after = advance
    ? ` of what's left after ${advanceTo === "you" ? "your" : `${advanceTo}'s`} advance is paid back`
    : " of each payment";
  if (mine) out.push(`You get ${pct(mine.basisPoints)}${after}.`);
  const others = rules.shares.filter((s) => s.userId !== userId);
  if (others.length)
    out.push(
      `${mine ? "" : advance ? "After the advance, " : ""}${list(
        others.map((s) => `${name(s.userId)} gets ${pct(s.basisPoints)}`),
      )}.`.replace(/^./, (c) => c.toUpperCase()),
    );
  if (advance) {
    const paidBack = agreement.value.recoupedByAdvance[advance.id] || 0;
    const advanceOwner = advanceTo === "you" ? "your" : `${advanceTo}'s`;
    out.push(
      `${formatMoneyHeadline(advance.amountCents)} is allocated toward ${advanceOwner} advance before the split${
        paidBack > 0
          ? ` (${formatMoneyHeadline(Math.min(paidBack, advance.amountCents))} allocated so far)`
          : ""
      }.`,
    );
  }
  if (rules.feePolicy === "BEFORE_SPLIT")
    out.push("PayPal's fee comes off before anything is split.");
  else {
    const bearer = rules.feeBearerId
      ? name(rules.feeBearerId)
      : "the organizer";
    out.push(
      `${bearer === "you" ? "You pay" : `${bearer.replace(/^./, (c) => c.toUpperCase())} pays`} PayPal's fee from ${bearer === "you" ? "your" : "their"} share.`,
    );
  }
  return out;
}

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
        title: "A payment needs checking",
        detail:
          "Payouts are paused until it's sorted. Nobody's share has changed.",
      });
    const latest = value.versions.at(-1);
    if (latest) {
      const review = contractReviewState(agreement, latest, userId);
      if (latest.status === "DRAFT" && member && review.blockers.length)
        attention.push({
          key: `${identity(agreement)}:review-blockers`,
          agreement,
          title: "Answer a few questions before sending",
          detail: review.blockers.join(" "),
        });
      else if (review.canSend)
        attention.push({
          key: `${identity(agreement)}:send-review`,
          agreement,
          title: "Send the split for approval",
          detail: "Questions are answered. Next, everyone approves.",
        });
      if (review.canActivate)
        attention.push({
          key: `${identity(agreement)}:activate`,
          agreement,
          title: "Switch on the new split",
          detail:
            "Everyone approved. Switch it on to start splitting payments.",
        });
      else if (review.canApprove)
        attention.push({
          key: `${identity(agreement)}:approval`,
          agreement,
          title: "Approve the split",
          detail: "Your approval is needed.",
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
          detail: "You can send a reminder from People.",
        });
      else if (
        latest.status === "AWAITING_APPROVAL" &&
        review.allApproved &&
        member?.role !== "ORGANIZER"
      )
        waiting.push({
          key: `${identity(agreement)}:waiting-activation`,
          agreement,
          title: "Waiting for the organizer to switch it on",
          detail:
            "Everyone approved. Waiting for the organizer to switch it on.",
        });
    }

    for (const event of value.audit) {
      if (!Number.isFinite(Date.parse(event.at))) continue;
      activity.push({
        key: `${identity(agreement)}:${event.sequence}`,
        agreement,
        at: event.at,
        text: activitySentence(agreement, event, userId),
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
        detail: `Recorded payout state: ${payout.status.toLowerCase().replaceAll("_", " ")}. Open the agreement to review the payout and resolve its blocker.`,
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
