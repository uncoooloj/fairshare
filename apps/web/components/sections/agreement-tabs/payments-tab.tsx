import type { Dispatch, SetStateAction } from "react";
import { AgreementInvoices } from "../../agreement-invoices";
import { Heading, RevenueTable, safePayPalUrl } from "../../agreement-widgets";
import { PaymentRecovery } from "../../payment-recovery";
import {
  api,
  money,
  type Agreement,
  type Revenue,
  type User,
  type Version,
} from "../../../lib/model";
import { Badge, Button, Empty } from "../../ui";
import type { Run } from "../types";

export interface AgreementPaymentsTabProps {
  selected: Agreement;
  active: Version | undefined;
  user: User;
  base: string;
  organizer: boolean;
  busy: boolean;
  payments: any[];
  payouts: any[];
  run: Run;
  refresh: () => Promise<void>;
  setBreakdown: Dispatch<SetStateAction<Revenue | null>>;
}

/** Invoices, incoming payments, recovery and verified allocations. */
export function AgreementPaymentsTab({
  selected,
  active,
  user,
  base,
  organizer,
  busy,
  payments,
  payouts,
  run,
  refresh,
  setBreakdown,
}: AgreementPaymentsTabProps) {
  return (
    <>
      <Heading
        small
        title="Incoming payments"
        description="Payments appear here once PayPal confirms them. Each share follows the agreed terms."
      />
      <AgreementInvoices
        key={selected.id}
        base={base}
        agreementName={selected.value.name}
        userId={user.id}
        canCreate={organizer && !!active}
      />
      <table>
        <thead>
          <tr>
            <th>Payment</th>
            <th>Source label</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td>
                <code>{p.id.slice(0, 8)}</code>
              </td>
              <td>{p.source_name || "PayPal"}</td>
              <td>{money(p.amount)}</td>
              <td>
                <Badge value={p.status} />
              </td>
              <td>
                <div className="actions">
                  {p.approval_url && safePayPalUrl(p.approval_url) && (
                    <a
                      href={p.approval_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open PayPal sandbox ↗
                    </a>
                  )}
                  {organizer && p.status === "AWAITING_BUYER" && (
                    <Button
                      variant="quiet"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(
                            `${base}/payments/${p.id}/capture`,
                            "POST",
                            {},
                          );
                          await refresh();
                        })
                      }
                    >
                      Confirm approved payment
                    </Button>
                  )}
                  {organizer && (
                    <Button
                      variant="quiet"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(
                            `${base}/payments/${p.id}/reconcile`,
                            "POST",
                            {},
                          );
                          await refresh();
                        })
                      }
                    >
                      Check status
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!payments.length && (
        <Empty title="No incoming payments yet">
          Once everyone approves your agreement, activate it and create an
          invoice to receive your first payment.
        </Empty>
      )}
      {organizer && (
        <PaymentRecovery
          key={base}
          base={base}
          payments={payments}
          payouts={payouts}
          held={!!selected.value.reviewHold}
          refresh={refresh}
        />
      )}
      <section className="section">
        <h3>Verified allocations</h3>
        <RevenueTable agreement={selected} onOpen={setBreakdown} />
      </section>
    </>
  );
}
