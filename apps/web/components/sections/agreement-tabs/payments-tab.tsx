import { paymentReconcilePath } from "../../../lib/payment-recovery";
import { useState, type Dispatch, type SetStateAction } from "react";
import { AgreementAllocations } from "../../agreement-allocations";
import { AgreementInvoices } from "../../agreement-invoices";
import { Drawer } from "../../allocation-drawer";
import { safePayPalUrl } from "../../agreement-widgets";
import { PaymentRecovery } from "../../payment-recovery";
import {
  api,
  money,
  title,
  type Agreement,
  type Revenue,
  type User,
  type Version,
} from "../../../lib/model";
import { Button, Empty } from "../../ui";
import type { Run } from "../types";

/** Payment statuses as people say them; anything unmapped falls back to plain casing. */
const PAYMENT_STATUS: Record<string, string> = {
  CREATING: "Starting",
  AWAITING_BUYER: "Waiting for payer",
  CAPTURING: "Collecting",
  ALLOCATED: "Received and allocated",
  HELD: "Being checked",
  OUTCOME_UNKNOWN: "Being checked",
};

const GOOD = new Set(["ALLOCATED"]);
const WARN = new Set(["HELD", "OUTCOME_UNKNOWN"]);

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

/** Get paid (payment links), the payments list, the splits, and recovery behind a drawer. */
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
}: AgreementPaymentsTabProps) {
  const [fixing, setFixing] = useState(false);
  const held = !!selected.value.reviewHold;
  return (
    <div className="ag-payments">
      <section className="panel ag-card ag-get-paid" id="get-paid">
        <h2>Get paid</h2>
        <p className="muted">
          {active
            ? "Request a payment and share the link. When it's paid, it's split automatically."
            : organizer
              ? "Once everyone approves, you can request payments here."
              : "Once everyone approves, payments show up here."}
        </p>
        <AgreementInvoices
          key={selected.id}
          base={base}
          agreementName={selected.value.name}
          userId={user.id}
          canCreate={organizer && !!active}
          onReconciled={refresh}
        />
      </section>
      <section className="panel ag-card">
        <h2>Payments</h2>
        {payments.length ? (
          <div style={{ overflowX: "auto" }}>
            <table className="ag-payments-table">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col" className="numeric">
                    Amount
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} title={`Payment ${p.id}`}>
                    <td>{p.source_name || "PayPal"}</td>
                    <td className="numeric">{money(p.amount)}</td>
                    <td>
                      <span
                        className={`status-chip ${GOOD.has(p.status) ? "good" : WARN.has(p.status) ? "warning" : ""}`}
                      >
                        {PAYMENT_STATUS[p.status] || title(p.status)}
                      </span>
                    </td>
                    <td>
                      <div className="actions">
                        {p.approval_url && safePayPalUrl(p.approval_url) && (
                          <a
                            href={p.approval_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open in PayPal (test) ↗
                          </a>
                        )}
                        {organizer &&
                          !p.invoice_id &&
                          p.status === "AWAITING_BUYER" && (
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
                              Collect payment
                            </Button>
                          )}
                        {organizer && (
                          <Button
                            variant="quiet"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await api(
                                  `${base}/${paymentReconcilePath(p)}`,
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
          </div>
        ) : (
          <Empty title="No payments yet">
            {active
              ? "Request a payment above to get paid."
              : "When everyone has approved, request a payment to get paid."}
          </Empty>
        )}
        {organizer && (
          <p className={`ag-fix-link ${held ? "is-held" : ""}`}>
            <button
              type="button"
              className="text-button"
              onClick={() => setFixing(true)}
            >
              Something wrong with a payment?
            </button>
          </p>
        )}
      </section>
      <AgreementAllocations agreement={selected} />
      {fixing && (
        <Drawer
          label="Something wrong with a payment?"
          onClose={() => setFixing(false)}
        >
          <PaymentRecovery
            key={base}
            base={base}
            payments={payments}
            payouts={payouts}
            held={held}
            refresh={refresh}
          />
        </Drawer>
      )}
    </div>
  );
}
