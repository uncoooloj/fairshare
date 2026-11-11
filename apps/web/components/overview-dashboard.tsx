"use client";
import { useEffect, useState } from "react";
import type { Agreement } from "../lib/model";
import { money } from "../lib/model";
import {
  overviewSummary,
  type OverviewPayout,
  type AttentionItem,
} from "../lib/overview-summary";
import { formatExact, formatWhen } from "../lib/dates";
import { toneInRoster } from "../lib/person";
import { Button } from "./ui";
import { Avatar, AvatarSize } from "./person";

enum AttentionKind {
  HOLD = "hold",
  APPROVAL = "approval",
  QUESTIONS = "questions",
  PAYOUT = "payout",
  WAITING = "waiting",
}

const COUNT_UP_MS = 600;
const ACTIVITY_LIMIT = 6;
/** The count-up plays once per page load, not on every return to Overview. */
let countUpPlayed = false;

function attentionKind(item: AttentionItem): AttentionKind {
  if (item.key.startsWith("payout:")) return AttentionKind.PAYOUT;
  const suffix = item.key.split(":").at(-1);
  return (
    Object.values(AttentionKind).find((kind) => kind === suffix) ??
    AttentionKind.APPROVAL
  );
}

const actionLabel: Record<AttentionKind, string> = {
  [AttentionKind.HOLD]: "Resolve",
  [AttentionKind.APPROVAL]: "Review",
  [AttentionKind.QUESTIONS]: "Resolve",
  [AttentionKind.PAYOUT]: "Check payout",
  [AttentionKind.WAITING]: "Open",
};

function AttentionIcon({ kind }: { kind: AttentionKind }) {
  const paths: Record<AttentionKind, string> = {
    [AttentionKind.HOLD]:
      "M12 8v5m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    [AttentionKind.PAYOUT]:
      "M15 9l-6 6m0-6 6 6m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    [AttentionKind.APPROVAL]:
      "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 14l2 2 4-4",
    [AttentionKind.QUESTIONS]:
      "M12 9v4m0 3h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
    [AttentionKind.WAITING]: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  };
  return (
    <span className={`ov-attention-icon kind-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
        <path
          d={paths[kind]}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** Animates 0 → value once on first mount. SSR and screen readers get the final value. */
function useCountUp(value: number | null) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (value === null || countUpPlayed) {
      setShown(value);
      return;
    }
    countUpPlayed = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let frame = 0;
    let done = false;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(value * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else done = true;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      // An interrupted run (e.g. StrictMode's double effect) may play again.
      if (!done) countUpPlayed = false;
      setShown(value);
    };
  }, [value]);
  return shown;
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: number | null;
  note: string;
}) {
  const shown = useCountUp(value);
  const final = value === null ? "Needs reconciliation" : money(value);
  return (
    <div className="ov-stat">
      <span className="ov-eyebrow">{label}</span>
      <strong className={value === null ? "ov-stat-flag" : "ov-stat-value"}>
        <span aria-hidden="true">{shown === null ? final : money(shown)}</span>
        <span className="sr-only">{final}</span>
      </strong>
      <span className="ov-stat-note">{note}</span>
    </div>
  );
}

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

  function row(item: AttentionItem, kind: AttentionKind) {
    return (
      <li key={item.key} className="ov-attention-row">
        <AttentionIcon kind={kind} />
        <div className="ov-row-text">
          <span className="ov-row-title">{item.title}</span>
          <span className="ov-row-context">
            {item.agreement.value.name} · {item.detail}
          </span>
        </div>
        <Button
          variant={kind === AttentionKind.WAITING ? "quiet" : "secondary"}
          className="ov-row-action"
          onClick={() => onOpen(item.agreement)}
        >
          {actionLabel[kind]}
        </Button>
      </li>
    );
  }

  function actorFor(event: (typeof summary.activity)[number]) {
    const value = event.agreement.value;
    const audit = value.audit.find(
      (a) => `${event.agreement.id}:${a.sequence}` === event.key,
    );
    if (!audit || audit.actorId === "provider")
      return { name: "Payment provider", tone: 5 };
    const member = value.members.find((m) => m.userId === audit.actorId);
    return {
      name: member?.displayName || "Participant",
      tone: toneInRoster(audit.actorId, value.members),
    };
  }

  const activity = summary.activity.slice(0, ACTIVITY_LIMIT);

  return (
    <>
      <div className="ov-stats">
        <StatCard
          label="Allocated across agreements"
          value={summary.allocated}
          note="All time · recorded shares"
        />
        <StatCard
          label="Confirmed paid out"
          value={summary.paid}
          note="Matching successful payouts"
        />
        <StatCard
          label="Not yet confirmed paid"
          value={summary.remaining}
          note="Allocated, no confirmed payout"
        />
      </div>
      <p
        className="ov-caveat"
        title="These are recorded shares, not an available balance. Holds, refunds and reversals may require reconciliation. Paid out includes only matching successful provider payouts."
      >
        <span aria-hidden="true">ⓘ</span> Recorded shares across agreements
        visible to you, not an available balance. Holds and refunds may need
        reconciliation.
      </p>
      <div className="ov-grid">
        <section className="ov-attention" aria-labelledby="ov-attention-title">
          <h2 id="ov-attention-title" className="ov-section-title">
            Needs your attention
            {summary.attention.length > 0 && (
              <span
                className="ov-count"
                aria-label={`${summary.attention.length} items`}
              >
                {summary.attention.length}
              </span>
            )}
          </h2>
          <div className="ov-card">
            {summary.attention.length ? (
              <ul className="ov-list">
                {summary.attention.map((item) =>
                  row(item, attentionKind(item)),
                )}
              </ul>
            ) : (
              <p className="ov-empty">Nothing needs you right now.</p>
            )}
            {summary.waiting.length > 0 && (
              <>
                <h3 className="ov-subhead">Waiting on others</h3>
                <ul className="ov-list">
                  {summary.waiting.map((item) =>
                    row(item, AttentionKind.WAITING),
                  )}
                </ul>
              </>
            )}
          </div>
        </section>
        <section
          className="ov-card ov-activity"
          aria-labelledby="ov-activity-title"
        >
          <h2 id="ov-activity-title" className="ov-rail-title">
            Recent activity
          </h2>
          {activity.length ? (
            <ol className="ov-timeline">
              {activity.map((event) => {
                const actor = actorFor(event);
                return (
                  <li key={event.key}>
                    <Avatar
                      name={actor.name}
                      tone={actor.tone}
                      size={AvatarSize.SMALL}
                    />
                    <p>
                      {event.text} ·{" "}
                      <button
                        className="ov-activity-link"
                        onClick={() => onOpen(event.agreement)}
                      >
                        {event.agreement.value.name}
                      </button>
                    </p>
                    <time dateTime={event.at} title={formatExact(event.at)}>
                      {formatWhen(event.at).replace(" ago", "")}
                    </time>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="ov-empty">
              Activity appears here as people review rules and payments are
              recorded.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
