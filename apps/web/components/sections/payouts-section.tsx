import dynamic from "next/dynamic";
import { allocationTrace } from "../../lib/allocation-trace";
import { payoutStatus } from "../../src/components/paymentGridModel";
import { Section, type Agreement } from "../../lib/model";
import {
  agreementIdentityKey,
  findAgreementByIdentity,
} from "../../lib/agreement-identity";
import type { Run } from "./types";

const PaymentGrid = dynamic(
  () => import("../../src/components/PaymentGrid").then((m) => m.PaymentGrid),
  { ssr: false, loading: () => <p>Loading payout history…</p> },
);

export interface PayoutsSectionProps {
  agreements: Agreement[];
  payouts: any[];
  busy: boolean;
  run: Run;
  navigate: (s: Section) => boolean;
  openAgreement: (a: Agreement) => Promise<void>;
}

/** Payout history across agreements. */
export function PayoutsSection({
  agreements,
  payouts,
  busy,
  run,
  navigate,
  openAgreement,
}: PayoutsSectionProps) {
  return (
    <>
      <PaymentGrid
        title="Payouts"
        description="Track money going to people, across all your agreements."
        emptyActions={
          <button
            type="button"
            className="text-button"
            onClick={() => navigate(Section.Agreements)}
          >
            Go to Agreements
          </button>
        }
        loading={busy}
        rows={payouts.map((p) => ({
          id: JSON.stringify([p.agreement.workspaceId, p.agreement.id, p.id]),
          payoutId: p.id,
          agreementKey: agreementIdentityKey(p.agreement),
          agreementId: p.agreement.id,
          agreementName: p.agreement.value.name,
          recipientName:
            p.agreement.value.members.find((m: any) => m.userId === p.user_id)
              ?.displayName || "Recipient",
          amountCents: p.amount,
          currency: "USD",
          status: payoutStatus(p.status),
          createdAt: p.createdAt ?? undefined,
          updatedAt: p.updatedAt ?? undefined,
          providerReference: p.item_id || p.batch_id || undefined,
          trace: allocationTrace(
            p.agreement,
            p.capture_id,
            p.user_id,
            p.amount,
          ),
        }))}
        onOpenAgreement={(id) => {
          const a = findAgreementByIdentity(agreements, id);
          if (a) run(() => openAgreement(a));
        }}
      />
    </>
  );
}
