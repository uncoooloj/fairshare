"use client";
import { Fragment, useState } from "react";
import { Button } from "./ui";
import type { Agreement } from "../lib/model";
import { money, title } from "../lib/model";
import { allocationRows } from "../lib/allocation-trace";
import { AllocationCalculation } from "./allocation-calculation";

export function AgreementAllocations({ agreement }: { agreement: Agreement }) {
  const rows = allocationRows(agreement);
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section className="panel">
      <h2>Allocations</h2>
      <p className="muted">
        Recorded shares, newest payment first. Each calculation uses the rules
        version recorded with its payment. Allocated does not mean paid.
      </p>
      {!rows.length ? (
        <p>
          No allocations yet. Shares appear after a payment is verified and
          allocated under approved rules.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <caption className="sr-only">Recorded allocation ledger</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Payment</th>
                <th>Person</th>
                <th>Amount</th>
                <th>Rule version</th>
                <th>Status & calculation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ revenue, allocation, name, trace }) => (
                <Fragment
                  key={`${revenue.providerCaptureId}:${allocation.userId}`}
                >
                  <tr>
                    <td>
                      {Number.isFinite(Date.parse(revenue.at))
                        ? new Date(revenue.at).toLocaleDateString()
                        : "Not recorded"}
                    </td>
                    <td>
                      {money(revenue.grossCents)} · PayPal
                      <br />
                      <code>{revenue.providerCaptureId}</code>
                    </td>
                    <td>{name}</td>
                    <td>{money(allocation.totalCents)}</td>
                    <td>v{revenue.versionId}</td>
                    <td>
                      {agreement.value.reviewHold ||
                      allocation.status === "HELD" ||
                      revenue.status === "REVIEW_REQUIRED"
                        ? "On hold for review"
                        : title(allocation.status)}
                      {trace ? (
                        <Button
                          variant="secondary"
                          aria-expanded={
                            expanded ===
                            `${revenue.providerCaptureId}:${allocation.userId}`
                          }
                          onClick={() =>
                            setExpanded(
                              expanded ===
                                `${revenue.providerCaptureId}:${allocation.userId}`
                                ? null
                                : `${revenue.providerCaptureId}:${allocation.userId}`,
                            )
                          }
                        >
                          View calculation for {name}
                        </Button>
                      ) : (
                        <p>
                          Calculation evidence unavailable. Reconcile this
                          record before relying on it.
                        </p>
                      )}
                    </td>
                  </tr>
                  {trace &&
                    expanded ===
                      `${revenue.providerCaptureId}:${allocation.userId}` && (
                      <tr>
                        <td colSpan={6}>
                          <AllocationCalculation trace={trace} />
                        </td>
                      </tr>
                    )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
