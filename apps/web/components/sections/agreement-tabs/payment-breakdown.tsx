import type { Dispatch, SetStateAction } from "react";
import { AllocationTable } from "../../agreement-widgets";
import { api, money, type Agreement, type Revenue } from "../../../lib/model";
import { Button } from "../../ui";
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
  return (
    <section className="panel breakdown">
      <div className="row">
        <h2>How this payment was split</h2>
        <Button variant="quiet" onClick={() => setBreakdown(null)}>
          Close
        </Button>
      </div>
      <p>
        {money(breakdown.grossCents)} paid − {money(breakdown.feeCents)} PayPal
        fee = {money(breakdown.netCents)} left to split.
      </p>
      <AllocationTable
        allocations={breakdown.allocations}
        agreement={selected}
      />
      <p className="muted">
        Applied version {breakdown.versionId}. Totals include advance payback.
      </p>
      <blockquote>
        {
          selected.value.versions.find((v) => v.id === breakdown.versionId)
            ?.rules.source.excerpt
        }
      </blockquote>
      {organizer && (
        <Button
          disabled={busy || selected.value.reviewHold}
          onClick={() =>
            run(async () => {
              await api(`${base}/payouts/dispatch`, "POST", {
                captureId: breakdown.providerCaptureId,
              });
              await refresh();
              setNotice(
                "Payouts sent (test). Check Payouts to see when they land.",
              );
            })
          }
        >
          Pay everyone (test)
        </Button>
      )}
    </section>
  );
}
