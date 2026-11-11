"use client";
import { Fragment, useState } from "react";
import type { Agreement } from "../lib/model";
import { money, title } from "../lib/model";
import { allocationRows } from "../lib/allocation-trace";
import { formatDay, formatExact } from "../lib/dates";
import { toneInRoster } from "../lib/person";
import { AllocationCalculation } from "./allocation-calculation";
import { Drawer } from "./allocation-drawer";
import { Avatar, AvatarSize } from "./person";

export function AgreementAllocations({
  agreement,
  onOpenDocument,
}: {
  agreement: Agreement;
  onOpenDocument?: () => void;
}) {
  const rows = allocationRows(agreement);
  const [open, setOpen] = useState<string | null>(null);
  const members = agreement.value.members;
  const groups = rows.reduce<{ captureId: string; rows: typeof rows }[]>(
    (list, row) => {
      const last = list.at(-1);
      if (last?.captureId === row.revenue.providerCaptureId)
        last.rows.push(row);
      else list.push({ captureId: row.revenue.providerCaptureId, rows: [row] });
      return list;
    },
    [],
  );
  const selected = rows.find(
    (row) =>
      `${row.revenue.providerCaptureId}:${row.allocation.userId}` === open,
  );
  return (
    <section className="panel">
      <h2>Allocations</h2>
      <p className="muted">
        Every share, newest payment first, calculated with the rules in force
        when the payment arrived. Select a row to see why.
      </p>
      {!rows.length ? (
        <div className="empty">
          <h3>No allocations yet</h3>
          <p>
            When a payment is confirmed, you’ll see exactly who gets what, and
            why.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <caption className="sr-only">Recorded allocation ledger</caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col" className="numeric">
                  Amount
                </th>
                <th scope="col">Rules</th>
                <th scope="col">Status</th>
                <th scope="col" aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {groups.map((group, index) => {
                const revenue = group.rows[0].revenue;
                const ordinal = groups.length - index;
                return (
                  <Fragment key={group.captureId}>
                    <tr className="ledger-group">
                      <th scope="colgroup" colSpan={5}>
                        Payment {ordinal} ·{" "}
                        <span title={formatExact(revenue.at)}>
                          {formatDay(revenue.at)}
                        </span>{" "}
                        · {money(revenue.grossCents)} via PayPal
                        <span className="muted">
                          {revenue.feeCents
                            ? `${money(revenue.feeCents)} fee`
                            : "No fee"}
                        </span>
                      </th>
                    </tr>
                    {group.rows.map(({ allocation, name, trace }) => {
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
                                  tone={toneInRoster(
                                    allocation.userId,
                                    members,
                                  )}
                                  size={AvatarSize.SMALL}
                                  label={false}
                                />
                                {name}
                              </button>
                            ) : (
                              name
                            )}
                          </td>
                          <td className="numeric">
                            {money(allocation.totalCents)}
                          </td>
                          <td>
                            <span className="version-chip">
                              v{revenue.versionId}
                            </span>
                          </td>
                          <td>
                            {trace ? (
                              <span
                                className={`status-chip${held ? " warning" : ""}`}
                              >
                                {held ? "On hold" : title(allocation.status)}
                              </span>
                            ) : (
                              <span className="status-chip warning">
                                Needs reconciling
                              </span>
                            )}
                          </td>
                          <td className="numeric" aria-hidden="true">
                            {trace && <span className="row-chevron">›</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {selected?.trace && (
        <Drawer label="Allocation detail" onClose={() => setOpen(null)}>
          <AllocationCalculation
            trace={selected.trace}
            name={selected.name}
            tone={toneInRoster(selected.allocation.userId, members)}
            onOpenDocument={
              onOpenDocument
                ? () => {
                    setOpen(null);
                    onOpenDocument();
                  }
                : undefined
            }
          />
        </Drawer>
      )}
    </section>
  );
}
