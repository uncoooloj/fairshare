"use client";
import { useState } from "react";
import type { Agreement } from "../lib/model";
import { money, title } from "../lib/model";
import { allocationRows } from "../lib/allocation-trace";
import { formatDay, formatExact } from "../lib/dates";
import { toneInRoster } from "../lib/person";
import { AllocationCalculation } from "./allocation-calculation";
import { Drawer } from "./allocation-drawer";
import { Avatar, AvatarSize } from "./person";
import { ChevronRightIcon } from "./icons";
import {
  payoutGridStatus,
  type PaymentGridStatus,
} from "../src/components/paymentGridModel";

/** One stored payout operation, as `/payouts` returns it (the Payouts page reads the same list). */
export interface AgreementPayout {
  capture_id: string;
  user_id: string;
  status: string;
  agreement?: { id: string };
}

export function AgreementAllocations({
  agreement,
  payouts = [],
}: {
  agreement: Agreement;
  payouts?: AgreementPayout[];
}) {
  const rows = allocationRows(agreement);
  const [open, setOpen] = useState<string | null>(null);
  const members = agreement.value.members;
  // The payment itself lives in the drawer; a date column tells payments apart.
  const multiplePayments =
    new Set(rows.map((row) => row.revenue.providerCaptureId)).size > 1;
  const payoutStatus = (captureId: string, userId: string) => {
    const payout = payouts.find(
      (p) =>
        (!p.agreement || p.agreement.id === agreement.id) &&
        p.capture_id === captureId &&
        p.user_id === userId,
    );
    return payout ? payoutGridStatus(payout.status) : undefined;
  };
  const selected = rows.find(
    (row) =>
      `${row.revenue.providerCaptureId}:${row.allocation.userId}` === open,
  );
  return (
    <section className="panel ag-card" id="agreement-splits">
      <h2>Splits</h2>
      <p className="muted">
        Each payment, split by the rules at the time. Tap a name to see the
        maths.
      </p>
      {!rows.length ? (
        <div className="empty">
          <h3>No splits yet</h3>
          <p>When a payment comes in, you’ll see who gets what, and why.</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            className={`ledger-table${multiplePayments ? " has-dates" : ""}`}
          >
            <caption className="sr-only">
              Who is owed what from each payment
            </caption>
            <thead>
              <tr>
                {multiplePayments && (
                  <th scope="col" className="ledger-date">
                    Date
                  </th>
                )}
                <th scope="col">Person</th>
                <th scope="col" className="numeric">
                  Amount
                </th>
                <th scope="col">
                  <span className="sr-only">Exceptions</span>
                </th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ revenue, allocation, name, trace }) => {
                const key = `${revenue.providerCaptureId}:${allocation.userId}`;
                const held =
                  agreement.value.reviewHold ||
                  allocation.status === "HELD" ||
                  revenue.status === "REVIEW_REQUIRED";
                return (
                  <tr
                    key={key}
                    className={`ledger-row${allocation.totalCents === 0 ? " is-zero" : ""}`}
                    onClick={() => trace && setOpen(key)}
                  >
                    {multiplePayments && (
                      <td
                        className="ledger-date muted"
                        title={formatExact(revenue.at)}
                      >
                        {formatDay(revenue.at)}
                      </td>
                    )}
                    <td>
                      {trace ? (
                        <button
                          type="button"
                          className="row-open"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpen(key);
                          }}
                          aria-label={`Why ${name} got ${money(allocation.totalCents)}`}
                        >
                          <Avatar
                            name={name}
                            tone={toneInRoster(allocation.userId, members)}
                            size={AvatarSize.SMALL}
                            label={false}
                          />
                          {name}
                        </button>
                      ) : (
                        name
                      )}
                    </td>
                    <td className="numeric">{money(allocation.totalCents)}</td>
                    <td>
                      {!trace ? (
                        <span className="status-chip warning">
                          Being checked
                        </span>
                      ) : held ? (
                        <span className="status-chip warning">On hold</span>
                      ) : allocation.status !== "ALLOCATED" ? (
                        <span className="status-chip">
                          {title(allocation.status)}
                        </span>
                      ) : null}
                    </td>
                    <td className="numeric" aria-hidden="true">
                      {trace && (
                        <span className="row-chevron">
                          <ChevronRightIcon />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {selected?.trace && (
        <Drawer label="How this was worked out" onClose={() => setOpen(null)}>
          <AllocationCalculation
            trace={selected.trace}
            name={selected.name}
            tone={toneInRoster(selected.allocation.userId, members)}
            payout={payoutStatus(
              selected.revenue.providerCaptureId,
              selected.allocation.userId,
            )}
            advanceTo={
              members.find(
                (m) =>
                  m.userId ===
                  selected.revenue.allocations.find(
                    (item) => item.recoupmentCents > 0,
                  )?.userId,
              )?.displayName
            }
          />
        </Drawer>
      )}
    </section>
  );
}
