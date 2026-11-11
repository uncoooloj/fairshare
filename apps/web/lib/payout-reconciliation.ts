import {
  agreementIdentityKey,
  findAgreementByIdentity,
} from "./agreement-identity";
import type { Agreement } from "./model";

export interface PayoutForReconciliation {
  id: string;
  batch_id?: string;
  agreement: Agreement;
}

/** Reconcile only payout batches the current user organizes, in server order. */
export async function reconcileOrganizerPayouts({
  payouts,
  agreements,
  userId,
  reconcile,
}: {
  payouts: readonly PayoutForReconciliation[];
  agreements: readonly Agreement[];
  userId: string;
  reconcile: (payout: PayoutForReconciliation) => Promise<void>;
}) {
  for (const payout of payouts) {
    const agreement = findAgreementByIdentity(
      agreements,
      agreementIdentityKey(payout.agreement),
    );
    const organizer = agreement?.value.members.some(
      (member: any) => member.userId === userId && member.role === "ORGANIZER",
    );
    if (organizer && payout.batch_id) await reconcile(payout);
  }
}
