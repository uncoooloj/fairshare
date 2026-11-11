import dynamic from "next/dynamic";
import { allocationTrace } from "../../lib/allocation-trace";
import { payoutStatus } from "../../src/components/paymentGridModel";
import { Section, api, type Agreement, type User } from "../../lib/model";
import { workspaceBase } from "../../lib/workspace-base";
import {
  agreementIdentityKey,
  findAgreementByIdentity,
} from "../../lib/agreement-identity";
import { Button } from "../ui";
import type { Run } from "./types";

const PaymentGrid = dynamic(
  () => import("../../src/components/PaymentGrid").then((m) => m.PaymentGrid),
  { ssr: false, loading: () => <p>Loading payout history…</p> },
);

export interface PayoutsSectionProps {
  user: User;
  agreements: Agreement[];
  payouts: any[];
  workspace: string;
  busy: boolean;
  run: Run;
  navigate: (s: Section) => boolean;
  openAgreement: (a: Agreement) => Promise<void>;
  loadWorkspace: (id: string) => Promise<void>;
}

/** Payout history across agreements, with organizer status refresh. */
export function PayoutsSection({
  user,
  agreements,
  payouts,
  workspace,
  busy,
  run,
  navigate,
  openAgreement,
  loadWorkspace,
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
      {payouts.length > 0 && (
        <Button
          variant="secondary"
          style={{ marginTop: 16 }}
          disabled={busy}
          onClick={() =>
            run(async () => {
              for (const p of payouts.filter(
                (p) =>
                  p.agreement.value.members.find(
                    (m: any) => m.userId === user.id,
                  )?.role === "ORGANIZER" && p.batch_id,
              )) {
                await api(
                  `${workspaceBase(p.agreement.workspaceId)}/collaborations/${p.agreement.id}/payouts/${p.id}/reconcile`,
                  "POST",
                  {},
                );
              }
              await loadWorkspace(workspace);
            })
          }
        >
          Refresh
        </Button>
      )}
    </>
  );
}
