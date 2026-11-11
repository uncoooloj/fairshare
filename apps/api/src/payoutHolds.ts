import { AllocationStatus } from "@fairshare/domain";
import type { Database } from "./database.js";

/** Why outgoing money for a capture must wait. Any of these blocks every
 * person's payout for that capture, not just one person. */
export enum PayoutHoldReason {
  REVIEW_HOLD = "REVIEW_HOLD",
  ALLOCATION_HELD = "ALLOCATION_HELD",
  REFUND = "REFUND",
  ADVERSE_EVENT = "ADVERSE_EVENT",
  APPROVALS_MISSING = "APPROVALS_MISSING",
}

export const payoutHoldMessages: Record<PayoutHoldReason, string> = {
  [PayoutHoldReason.REVIEW_HOLD]:
    "Outgoing funds held while the agreement is under review",
  [PayoutHoldReason.ALLOCATION_HELD]: "Allocation held",
  [PayoutHoldReason.REFUND]: "Payment has a refund; payouts are held",
  [PayoutHoldReason.ADVERSE_EVENT]:
    "A PayPal dispute or reversal is still being processed; payouts are held",
  [PayoutHoldReason.APPROVALS_MISSING]:
    "Not everyone has approved the rules for this payment; payouts are held",
};

/** Per-person parked states that a later dispatch may pick up again. */
export const PARKED_PAYOUT_STATUSES = ["WAITING_RECIPIENT", "AUTO_HELD"];

type Agreement = {
  reviewHold?: boolean;
  members: { userId: string }[];
  versions: { id: number; approvals: Record<string, unknown> }[];
};
type Revenue = { versionId: number };

/** The single hold rule shared by manual and automatic payouts. */
export function payoutHoldReason(
  db: Database,
  agreement: Agreement,
  revenue: Revenue,
  captureId: string,
  allocations: { status: string }[],
): PayoutHoldReason | null {
  if (agreement.reviewHold) return PayoutHoldReason.REVIEW_HOLD;
  if (allocations.some((a) => a.status !== AllocationStatus.ALLOCATED))
    return PayoutHoldReason.ALLOCATION_HELD;
  if (
    db
      .prepare("SELECT id FROM fairshare_refund_ops WHERE capture_id=? LIMIT 1")
      .get(captureId)
  )
    return PayoutHoldReason.REFUND;
  const adverse = (
    db
      .prepare(
        "SELECT action FROM fairshare_webhook_inbox WHERE status='PENDING'",
      )
      .all() as { action: string }[]
  ).some((entry) => {
    try {
      const action = JSON.parse(entry.action);
      // Conservative: any pending capture-hold event is processed before new outgoing funds.
      return action.kind === "HOLD_CAPTURE" || action.kind === "HoldCapture";
    } catch {
      return true;
    }
  });
  if (adverse) return PayoutHoldReason.ADVERSE_EVENT;
  const version = agreement.versions.find((v) => v.id === revenue.versionId);
  if (
    !version ||
    !agreement.members.every((m) => Object.hasOwn(version.approvals, m.userId))
  )
    return PayoutHoldReason.APPROVALS_MISSING;
  return null;
}
