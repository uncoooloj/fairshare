import type { Dispatch, SetStateAction } from "react";
import { AllocationTable } from "../../agreement-widgets";
import { api, money, type Agreement, type Revenue } from "../../../lib/model";
import { Button } from "../../ui";
import {
  PaymentConfirmation,
  automaticPayoutCopy,
  dispatchSummary,
  usePaymentSetup,
  type DispatchResult,
} from "../../../lib/payment-setup";
import type { Run } from "../types";

export interface PaymentBreakdownProps {
  breakdown: Revenue;
  selected: Agreement;
  organizer: boolean;
  busy: boolean;
  base: string;
  run: Run;
  refresh: () => Promise<void>;
  setBreakdown: Dispatch<SetStateAction<Revenue | null>>;
  setNotice: Dispatch<SetStateAction<string>>;
}

/** How one payment was allocated, with the organizer's sandbox dispatch. */
export function PaymentBreakdown({
  breakdown,
  selected,
  organizer,
  busy,
  base,
  run,
  refresh,
  setBreakdown,
  setNotice,
}: PaymentBreakdownProps) {
  const setup = usePaymentSetup(base);
  const nameOf = (userId: string) =>
    selected.value.members.find((m) => m.userId === userId)?.displayName ||
    "this person";
  return (
    <section className="panel breakdown">
      <div className="row">
        <h2>How this payment was allocated</h2>
        <Button variant="quiet" onClick={() => setBreakdown(null)}>
          Close
        </Button>
      </div>
      <p>
        Received {money(breakdown.grossCents)} − PayPal fee{" "}
        {money(breakdown.feeCents)} = {money(breakdown.netCents)} to split.
      </p>
      <AllocationTable
        allocations={breakdown.allocations}
        agreement={selected}
      />
      <p className="muted">
        Applied version {breakdown.versionId}. Recoupment is included in each
        recipient’s total. An allocation is not proof of payout.
      </p>
      <blockquote>
        {
          selected.value.versions.find((v) => v.id === breakdown.versionId)
            ?.rules.source.excerpt
        }
      </blockquote>
      {organizer && (
        <Button
          disabled={
            busy ||
            selected.value.reviewHold ||
            setup?.paymentConfirmation === PaymentConfirmation.NOT_CONFIGURED ||
            setup?.payoutsReady === false
          }
          onClick={() =>
            run(async () => {
              const result = await api<{ payouts: DispatchResult[] }>(
                `${base}/payouts/dispatch`,
                "POST",
                { captureId: breakdown.providerCaptureId },
              );
              await refresh();
              setNotice(dispatchSummary(result.payouts, nameOf));
            })
          }
        >
          Send fixed allocations in sandbox
        </Button>
      )}
      <p className="muted">{automaticPayoutCopy(setup)}</p>
    </section>
  );
}
