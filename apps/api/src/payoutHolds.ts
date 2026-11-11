import { AllocationStatus } from "@fairshare/domain";
import type { Database } from "./database.js";
import { pendingWebhookBlocksPayout } from "./paymentSafety.js";
import { PAYOUT_BLOCKING_REFUND_SQL } from "./refundReversal.js";

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
  [PayoutHoldReason.REFUND]:
    "A refund on this payment is still going through; payouts from it wait",
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
type Capture = {
  provider_capture_id: string;
  workspace_id: string;
  collaboration_id: string;
};

/** The single hold rule shared by manual and automatic payouts. */
export function payoutHoldReason(
  db: Database,
  agreement: Agreement,
  revenue: Revenue,
  capture: Capture,
  allocations: { status: string }[],
): PayoutHoldReason | null {
  if (agreement.reviewHold) return PayoutHoldReason.REVIEW_HOLD;
  if (allocations.some((a) => a.status !== AllocationStatus.ALLOCATED))
    return PayoutHoldReason.ALLOCATION_HELD;
  // A refund applied to the split no longer blocks; one still moving money, or a legacy full
  // refund that was never taken out of the split, does.
  if (
    db
      .prepare(
        `SELECT id FROM fairshare_refund_ops WHERE capture_id=? AND ${PAYOUT_BLOCKING_REFUND_SQL} LIMIT 1`,
      )
      .get(capture.provider_capture_id)
  )
    return PayoutHoldReason.REFUND;
  if (pendingWebhookBlocksPayout(db, capture))
    return PayoutHoldReason.ADVERSE_EVENT;
  const version = agreement.versions.find((v) => v.id === revenue.versionId);
  if (
    !version ||
    !agreement.members.every((m) => Object.hasOwn(version.approvals, m.userId))
  )
    return PayoutHoldReason.APPROVALS_MISSING;
  return null;
}
