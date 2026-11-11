"use client";
import type { Agreement } from "../lib/model";
import { money } from "../lib/model";
import {
  overviewSummary,
  type OverviewPayout,
  type AttentionItem,
} from "../lib/overview-summary";
import { Button } from "./ui";
import { Metric } from "./agreement-widgets";

export function OverviewDashboard({
  agreements,
  payouts,
  userId,
  onOpen,
}: {
  agreements: Agreement[];
  payouts: OverviewPayout[];
  userId: string;
  onOpen: (agreement: Agreement) => void;
}) {
  const summary = overviewSummary(agreements, payouts, userId);
  const display = (amount: number | null) =>
    amount === null ? "Needs reconciliation" : money(amount);
  function queue(items: AttentionItem[], empty: string) {
    return items.length ? (
      <ul style={{ listStyle: "none", padding: 0 }}>
        {items.map((item) => (
          <li
            key={item.key}
            style={{
              padding: "16px 0",
              borderBottom: "1px solid var(--color-line)",
            }}
          >
            <strong>{item.title}</strong>
            <p>{item.agreement.value.name}</p>
            <p className="muted">{item.detail}</p>
            <Button variant="secondary" onClick={() => onOpen(item.agreement)}>
              Open agreement
            </Button>
          </li>
        ))}
      </ul>
    ) : (
      <p className="muted">{empty}</p>
    );
  }
  return (
    <>
      <p className="muted">
        All-time · agreements visible to you in this workspace
      </p>
      <div className="metrics">
        <Metric
          label="Recorded allocations"
          value={display(summary.allocated)}
        />
        <Metric label="Confirmed paid out" value={display(summary.paid)} />
        <Metric label="Not confirmed paid" value={display(summary.remaining)} />
      </div>
      <p className="muted">
        These are recorded shares, not an available balance. Holds, refunds and
        reversals may require reconciliation. Paid out includes only matching
        successful provider payouts.
      </p>
      <div className="detail-columns">
        <section className="panel">
          <h2>
            Needs your attention{" "}
            <span className="muted">({summary.attention.length})</span>
          </h2>
          {queue(
            summary.attention,
            "Nothing needs your attention in the loaded records.",
          )}
        </section>
        <section className="panel">
          <h2>Waiting on others</h2>
          {queue(summary.waiting, "No pending approvals from others.")}
        </section>
      </div>
      <section className="panel">
        <h2>Recent activity</h2>
        {summary.activity.length ? (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {summary.activity.map((event) => (
              <li
                key={event.key}
                style={{
                  padding: "12px 0",
                  borderBottom: "1px solid var(--color-line)",
                }}
              >
                <strong>{event.text}</strong>
                <p>
                  <button
                    className="text-button"
                    onClick={() => onOpen(event.agreement)}
                  >
                    {event.agreement.value.name}
                  </button>{" "}
                  ·{" "}
                  <time dateTime={event.at}>
                    {new Date(event.at).toLocaleString()}
                  </time>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            Agreement activity appears here as people review rules and payments
            are recorded.
          </p>
        )}
      </section>
    </>
  );
}
