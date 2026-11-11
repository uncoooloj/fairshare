"use client";
import { useEffect, useState } from "react";
import type { Agreement } from "../lib/model";
import { formatMoneyHeadline } from "../lib/preferences";
import {
  overviewSummary,
  type OverviewPayout,
  type AttentionItem,
} from "../lib/overview-summary";
import { formatExact, formatWhen } from "../lib/dates";
import { toneInRoster } from "../lib/person";
import { Button } from "./ui";
import { Avatar, AvatarSize } from "./person";
import { PaymentIcon } from "./icons";

enum AttentionKind {
  HOLD = "hold",
  APPROVAL = "approval",
  QUESTIONS = "questions",
  PAYOUT = "payout",
  WAITING = "waiting",
}

const COUNT_UP_MS = 600;
const ACTIVITY_LIMIT = 6;
const MINUTE_MS = 60_000;
const PAYMENT_ALLOCATED = "Payment allocated";
const PROVIDER_NAME = "Payment provider";
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

type ActivityEvent = ReturnType<typeof overviewSummary>["activity"][number];
type ActivityGroup = ActivityEvent & { count: number };

/** Merges consecutive identical events (same text, agreement and minute) into one counted line. */
function collapseActivity(events: ActivityEvent[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const event of events) {
    const last = groups.at(-1);
    if (
      last &&
      last.text === event.text &&
      last.agreement.id === event.agreement.id &&
      last.agreement.workspaceId === event.agreement.workspaceId &&
      Math.floor(Date.parse(last.at) / MINUTE_MS) ===
        Math.floor(Date.parse(event.at) / MINUTE_MS)
    ) {
      last.count += 1;
      continue;
    }
    groups.push({ ...event, count: 1 });
  }
  return groups;
}

function activityText(group: ActivityGroup) {
  if (group.count === 1) return group.text;
  if (group.text === PAYMENT_ALLOCATED)
    return `${group.count} payments allocated`;
  return `${group.text} ×${group.count}`;
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
  const final = value === null ? "Being checked" : formatMoneyHeadline(value);
  return (
    <div className="ov-stat">
      <span className="ov-eyebrow">{label}</span>
      <strong className={value === null ? "ov-stat-flag" : "ov-stat-value"}>
        <span aria-hidden="true">
          {shown === null ? final : formatMoneyHeadline(shown)}
        </span>
        <span className="sr-only">{final}</span>
      </strong>
      <span className="ov-stat-note">{note}</span>
    </div>
  );
}

export function OverviewDashboard({
  agreements,
  payouts,
  payoutsComplete,
  payoutsUnavailable,
  userId,
  onOpen,
  onSendReminder,
}: {
  agreements: Agreement[];
  payouts: OverviewPayout[];
  payoutsComplete: boolean;
  payoutsUnavailable: boolean;
  userId: string;
  onOpen: (agreement: Agreement) => void;
  onSendReminder: (agreement: Agreement) => void;
}) {
  const summary = overviewSummary(agreements, payouts, userId, payoutsComplete);

  function canSendReminder(item: AttentionItem, kind: AttentionKind) {
    return (
      kind === AttentionKind.WAITING &&
      item.key.endsWith(":waiting") &&
      item.agreement.value.members.some(
        (member) => member.userId === userId && member.role === "ORGANIZER",
      )
    );
  }

  function row(item: AttentionItem, kind: AttentionKind) {
    const sendReminder = canSendReminder(item, kind);
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
          onClick={() =>
            sendReminder
              ? onSendReminder(item.agreement)
              : onOpen(item.agreement)
          }
        >
          {sendReminder ? "Send reminder" : actionLabel[kind]}
        </Button>
      </li>
    );
  }

  function actorFor(event: (typeof summary.activity)[number]) {
    const value = event.agreement.value;
    const audit = value.audit.find(
      (a) =>
        `${JSON.stringify([event.agreement.workspaceId, event.agreement.id])}:${a.sequence}` ===
        event.key,
    );
    if (!audit || audit.actorId === "provider")
      return { name: PROVIDER_NAME, tone: 5 };
    const member = value.members.find((m) => m.userId === audit.actorId);
    return {
      name: member?.displayName || "Participant",
      tone: toneInRoster(audit.actorId, value.members),
    };
  }

  const activity = collapseActivity(summary.activity).slice(0, ACTIVITY_LIMIT);
  const hasActionableAttention = summary.attention.length > 0;
  const hasWaitingOnOthers = summary.waiting.length > 0;
  const allClear =
    payoutsComplete && !hasActionableAttention && !hasWaitingOnOthers;
  const lastSplitAt = agreements
    .flatMap((a) => a.value.revenue.map((r) => r.at))
    .filter((at) => Number.isFinite(Date.parse(at)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

  return (
    <>
      <div className="ov-stats">
        <StatCard
          label={
            summary.scope === "personal"
              ? "Your allocated share"
              : "Owed so far"
          }
          value={summary.allocated}
          note="From every payment so far"
        />
        <StatCard
          label={summary.scope === "personal" ? "Paid to you" : "Paid out"}
          value={summary.paid}
          note="Money that reached people"
        />
        <StatCard
          label="Not confirmed paid"
          value={summary.remaining}
          note="Owed, not yet confirmed paid"
        />
      </div>
      {!payoutsComplete && (
        <p className="ov-caveat" role={payoutsUnavailable ? "alert" : "status"}>
          {payoutsUnavailable
            ? "We couldn’t load payouts, so totals are hidden. Refresh to try again."
            : "Loading your totals…"}
        </p>
      )}

      {allClear && (
        <div className="ov-card ov-all-clear" role="status">
          <span className="ov-all-clear-dot" aria-hidden="true" />
          <span className="ov-all-clear-text">
            Nothing needs you right now.
          </span>
          {lastSplitAt && (
            <span className="ov-all-clear-meta">
              Last payment split{" "}
              <time dateTime={lastSplitAt} title={formatExact(lastSplitAt)}>
                {formatWhen(lastSplitAt)}
              </time>
            </span>
          )}
        </div>
      )}
      <div className={allClear ? "ov-grid is-clear" : "ov-grid"}>
        {!allClear && (
          <section
            className="ov-card ov-attention"
            aria-labelledby="ov-attention-title"
          >
            <h2 id="ov-attention-title" className="ov-card-title">
              Needs your attention
              {hasActionableAttention && (
                <span
                  className="ov-count"
                  aria-label={`${summary.attention.length} items`}
                >
                  {summary.attention.length}
                </span>
              )}
            </h2>
            {hasActionableAttention ? (
              <ul className="ov-list">
                {summary.attention.map((item) =>
                  row(item, attentionKind(item)),
                )}
              </ul>
            ) : !hasWaitingOnOthers ? (
              <p className="ov-empty">
                {payoutsComplete
                  ? "Nothing needs you right now."
                  : "We’ll show payout issues once payouts load."}
              </p>
            ) : null}
            {hasWaitingOnOthers && (
              <>
                <h3 className="ov-subhead">Waiting on others</h3>
                <ul className="ov-list">
                  {summary.waiting.map((item) =>
                    row(item, AttentionKind.WAITING),
                  )}
                </ul>
              </>
            )}
          </section>
        )}
        <section
          className="ov-card ov-activity"
          aria-labelledby="ov-activity-title"
        >
          <h2 id="ov-activity-title" className="ov-card-title">
            Recent activity
          </h2>
          {activity.length ? (
            <ol className="ov-timeline">
              {activity.map((event) => {
                const actor = actorFor(event);
                return (
                  <li key={event.key}>
                    {actor.name === PROVIDER_NAME ? (
                      <span className="ov-system-avatar" aria-hidden="true">
                        <PaymentIcon size={13} />
                      </span>
                    ) : (
                      <Avatar
                        name={actor.name}
                        tone={actor.tone}
                        size={AvatarSize.SMALL}
                      />
                    )}
                    <p>
                      {activityText(event)}
                      <span className="ov-sep" aria-hidden="true">
                        {" · "}
                      </span>
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
              Approvals and payments will show up here.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
