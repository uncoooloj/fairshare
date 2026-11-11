"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { money, type Agreement, type Rules, type Version } from "../lib/model";
import { formatDay, formatExact } from "../lib/dates";
import { toneInRoster } from "../lib/person";
import { RECEIVED_DEFINITION, receivedTotals } from "../lib/received";
import { Avatar, AvatarSize, SplitBar } from "./person";
import { overviewSummary, type OverviewPayout } from "../lib/overview-summary";
import {
  agreementStatus,
  StageAction,
  type AgreementStatus,
} from "../lib/agreement-status";
import { Button } from "./ui";
import { NudgeDrawer } from "./person-share";
import { unconfirmedAdvance } from "../lib/advance-status";
import { confirmAdvancePaid } from "../lib/agreement-api";

export enum RuleKind {
  NetRevenue = "Fees first",
  Recoupment = "Advance payback",
  Split = "Split",
  Fees = "Fees",
}

export enum RuleStepsLayout {
  /** Overview: a numbered list with person chips. */
  List = "list",
  /** Terms: one bordered card per rule, split shown as a bar with rows. */
  Cards = "cards",
}

interface StepPerson {
  userId: string;
  name: string;
  basisPoints?: number;
}

interface RuleStep {
  kind: RuleKind;
  sentence: ReactNode;
  /** Empty means the rule applies to everyone. */
  people: StepPerson[];
  clause?: string;
}

function memberName(agreement: Agreement, userId: string) {
  return (
    agreement.value.members.find((m) => m.userId === userId)?.displayName ||
    "Former participant"
  );
}

function percent(basisPoints: number) {
  return `${basisPoints / 100}%`;
}

/** Steps follow the order the engine applies them: fees, advance, split. */
function ruleSteps(agreement: Agreement, rules: Rules): RuleStep[] {
  const steps: RuleStep[] = [];
  const beforeSplit = rules.feePolicy === "BEFORE_SPLIT";
  if (beforeSplit)
    steps.push({
      kind: RuleKind.NetRevenue,
      sentence: "PayPal's fee comes off first.",
      people: [],
    });
  if (rules.advance)
    steps.push({
      kind: RuleKind.Recoupment,
      sentence: (
        <>
          {memberName(agreement, rules.advance.recipientId)} gets their{" "}
          <strong>{money(rules.advance.amountCents)}</strong> advance paid back
          first.
        </>
      ),
      people: [
        {
          userId: rules.advance.recipientId,
          name: memberName(agreement, rules.advance.recipientId),
        },
      ],
      clause: rules.advance.source.clause,
    });
  const shares = rules.shares.map((s) => ({
    userId: s.userId,
    name: memberName(agreement, s.userId),
    basisPoints: s.basisPoints,
  }));
  steps.push({
    kind: RuleKind.Split,
    sentence:
      shares.length === 1
        ? `${shares[0].name} receives ${percent(shares[0].basisPoints)}.`
        : `${rules.advance ? "The rest is" : "Each payment is"} split ${shares
            .map((s) => s.basisPoints / 100)
            .join(" / ")}.`,
    people: shares,
    clause: rules.source.clause,
  });
  if (!beforeSplit) {
    const bearer = rules.feeBearerId
      ? memberName(agreement, rules.feeBearerId)
      : "The organizer";
    steps.push({
      kind: RuleKind.Fees,
      sentence: `${bearer} pays PayPal's fee from their share.`,
      people: rules.feeBearerId
        ? [{ userId: rules.feeBearerId, name: bearer }]
        : [],
    });
  }
  return steps;
}

function ClauseChip({ clause }: { clause?: string }) {
  if (!clause?.trim()) return null;
  return (
    <span className="clause-chip" title={`Source clause ${clause}`}>
      § {clause.replace(/^(clause|section)\s+/i, "")}
    </span>
  );
}

function ThinProgress({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div
      className={`ag-progress ${ratio >= 1 ? "is-complete" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
    >
      <span style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function RuleSteps({
  agreement,
  rules,
  layout = RuleStepsLayout.List,
}: {
  agreement: Agreement;
  rules: Rules;
  layout?: RuleStepsLayout;
}) {
  const roster = agreement.value.members;
  const steps = ruleSteps(agreement, rules);
  const recouped = rules.advance
    ? agreement.value.recoupedByAdvance[rules.advance.id] || 0
    : 0;
  return (
    <ol className={`ag-rules ag-rules-${layout}`}>
      {steps.map((step, index) => (
        <li key={step.kind} className="ag-rule">
          <span className="ag-rule-number" aria-hidden="true">
            {index + 1}
          </span>
          <div className="ag-rule-body">
            <div className="ag-rule-head">
              <span className="ag-rule-label">{step.kind}</span>
              <ClauseChip clause={step.clause} />
            </div>
            <p className="ag-rule-sentence">{step.sentence}</p>
            {step.kind === RuleKind.Split &&
            layout === RuleStepsLayout.Cards ? (
              <div className="ag-split">
                <SplitBar
                  segments={step.people.map((p) => ({
                    userId: p.userId,
                    name: p.name,
                    basisPoints: p.basisPoints || 0,
                    tone: toneInRoster(p.userId, roster),
                  }))}
                />
                <ul className="ag-split-rows">
                  {step.people.map((p) => (
                    <li key={p.userId}>
                      <Avatar
                        name={p.name}
                        tone={toneInRoster(p.userId, roster)}
                        size={AvatarSize.SMALL}
                        label={false}
                      />
                      <span>{p.name}</span>
                      <strong className="numeric">
                        {percent(p.basisPoints || 0)}
                      </strong>
                    </li>
                  ))}
                  <li className="ag-split-total">
                    <span>Total</span>
                    <strong className="numeric">
                      {percent(
                        step.people.reduce(
                          (t, p) => t + (p.basisPoints || 0),
                          0,
                        ),
                      )}
                    </strong>
                  </li>
                </ul>
              </div>
            ) : step.people.length ? (
              <ul className="ag-chips" aria-label="People">
                {step.people.map((p) => (
                  <li key={p.userId} className="ag-person-chip">
                    <Avatar
                      name={p.name}
                      tone={toneInRoster(p.userId, roster)}
                      size={AvatarSize.SMALL}
                      label={false}
                    />
                    {p.name}
                    {p.basisPoints !== undefined && (
                      <strong className="numeric">
                        {percent(p.basisPoints)}
                      </strong>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              layout === RuleStepsLayout.List && (
                <small className="muted">Everyone</small>
              )
            )}
            {step.kind === RuleKind.Recoupment &&
              rules.advance &&
              layout === RuleStepsLayout.List && (
                <div className="ag-rule-live">
                  <ThinProgress
                    value={recouped}
                    max={rules.advance.amountCents}
                    label="Advance paid back"
                  />
                  <small className="muted numeric">
                    {money(recouped)} of {money(rules.advance.amountCents)} paid
                    back
                    {!rules.advance.verified && " · advance not confirmed"}
                  </small>
                </div>
              )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function latestApproval(version: Version) {
  const times = Object.values(version.approvals)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : undefined;
}

/** Header meta from real version data only: never a fabricated date. */
export function versionMeta(agreement: Agreement) {
  const versions = agreement.value.versions;
  const latest = versions.at(-1);
  const active = versions.find((v) => v.id === agreement.value.activeVersionId);
  if (!latest) return { text: "No split yet", exact: undefined };
  const parts: string[] = [];
  let exact: string | undefined;
  if (active) {
    const at = latestApproval(active);
    exact = formatExact(at);
    if (at) parts.push(`Approved ${formatDay(at)}`);
  }
  if (active && latest !== active && latest.status === "AWAITING_APPROVAL")
    parts.push("Change waiting for approval");
  const people = agreement.value.members.length;
  parts.push(`${people} ${people === 1 ? "person" : "people"}`);
  return { text: parts.join(" · "), exact };
}

/** One line that says where things stand, with at most one button. */
export function StatusLine({
  status,
  onAction,
}: {
  status: AgreementStatus;
  onAction: (action: StageAction) => void;
}) {
  const label =
    status.action === StageAction.Approve
      ? "Review and approve"
      : status.action === StageAction.SeeRequest
        ? "See request"
        : status.action === StageAction.Nudge
          ? "Nudge"
          : status.action === StageAction.ConfirmAdvance
            ? "Confirm it’s paid"
            : "";
  return (
    <div
      className={`ag-status ${status.tone ? `is-${status.tone}` : ""}`}
      role="status"
    >
      <span className="ag-status-dot" aria-hidden="true" />
      <p className="ag-status-line">
        {status.line}
        {status.note && <span className="ag-status-note"> {status.note}</span>}
      </p>
      {label && (
        <Button
          variant={
            status.action === StageAction.SeeRequest ||
            status.action === StageAction.Nudge
              ? "secondary"
              : "primary"
          }
          onClick={() => onAction(status.action)}
        >
          {label}
        </Button>
      )}
    </div>
  );
}

export function AgreementHeader({
  agreement,
  userId,
  onStatusAction,
  onBack,
  onViewPayouts,
  rename,
  renameSuggested = false,
  onAgreementChange,
}: {
  agreement: Agreement;
  /** The viewer: the status line is written from their side. */
  userId: string;
  onStatusAction: (action: StageAction) => void;
  onBack: () => void;
  onViewPayouts: () => void;
  /** Rename form, only for people allowed to rename. */
  rename?: (open: boolean, close: () => void) => ReactNode;
  /** A suggested name keeps the review prompt visible without the menu. */
  renameSuggested?: boolean;
  /** Newer agreement after a link is created or the advance is confirmed. */
  onAgreementChange?: (agreement: Agreement) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const menuButton = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const status = agreementStatus(agreement, userId);
  const advance = unconfirmedAdvance(agreement);
  const statusAction = (action: StageAction) => {
    if (action === StageAction.Nudge) setNudging(true);
    else if (action === StageAction.ConfirmAdvance) {
      setConfirmError("");
      setConfirming(true);
    } else onStatusAction(action);
  };
  async function confirmPaid() {
    if (!advance || confirmBusy) return;
    setConfirmBusy(true);
    setConfirmError("");
    try {
      const next = await confirmAdvancePaid(
        agreement.workspaceId,
        agreement.id,
        agreement.revision,
        advance.advanceId,
      );
      onAgreementChange?.(next);
      setConfirming(false);
    } catch (cause) {
      setConfirmError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t confirm it. Try again.",
      );
    } finally {
      setConfirmBusy(false);
    }
  }
  const meta = versionMeta(agreement);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        menu.current?.contains(event.target as Node)
      )
        return;
      if (menu.current) menu.current.open = false;
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const choose = (action: () => void) => {
    if (menu.current) menu.current.open = false;
    action();
  };
  return (
    <header className="ag-header">
      <nav aria-label="Breadcrumb" className="ag-breadcrumb">
        <button type="button" className="text-button" onClick={onBack}>
          Agreements
        </button>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{agreement.value.name}</span>
      </nav>
      <div className="ag-title-row">
        <div>
          <div className="ag-title">
            <h1>{agreement.value.name}</h1>
            <span className={`status-chip ${status.tone}`}>{status.chip}</span>
          </div>
          <p className="ag-meta" title={meta.exact}>
            {meta.text}
          </p>
        </div>
        <details
          ref={menu}
          className="ag-menu"
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary
            ref={menuButton}
            className="icon-button"
            aria-label="Agreement actions"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3" cy="8" r="1.4" fill="currentColor" />
              <circle cx="8" cy="8" r="1.4" fill="currentColor" />
              <circle cx="13" cy="8" r="1.4" fill="currentColor" />
            </svg>
          </summary>
          <div className="ag-menu-list" role="menu">
            {rename && (
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(() => setRenaming(true))}
              >
                Edit agreement name
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onViewPayouts)}
            >
              View payouts
            </button>
          </div>
        </details>
      </div>
      <StatusLine status={status} onAction={statusAction} />
      {confirming &&
        advance &&
        status.action === StageAction.ConfirmAdvance && (
          <div
            className="ag-confirm-advance"
            role="group"
            aria-label="Confirm the advance"
          >
            <p>
              Only confirm once the {money(advance.amountCents)} has actually
              been paid. The split switches on right away.
            </p>
            {confirmError && <p role="alert">{confirmError}</p>}
            <div className="row">
              <Button
                type="button"
                disabled={confirmBusy}
                onClick={() => void confirmPaid()}
              >
                {confirmBusy ? "Confirming…" : "Yes, it’s paid"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirming(false)}
              >
                Not yet
              </Button>
            </div>
          </div>
        )}
      {nudging && (
        <NudgeDrawer
          agreement={agreement}
          userId={userId}
          onClose={() => setNudging(false)}
          onAgreementChange={onAgreementChange}
        />
      )}
      {rename &&
        (renaming || renameSuggested) &&
        rename(renaming, () => {
          setRenaming(false);
          menuButton.current?.focus();
        })}
    </header>
  );
}

export function RecoupmentCard({
  agreement,
  rules,
  children,
}: {
  agreement: Agreement;
  rules: Rules;
  children?: ReactNode;
}) {
  if (!rules.advance) return null;
  const amount = rules.advance.amountCents;
  const recouped = agreement.value.recoupedByAdvance[rules.advance.id] || 0;
  const complete = amount > 0 && recouped >= amount;
  return (
    <section className="panel ag-card ag-recoupment">
      <div className="ag-card-head">
        <h2>Advance allocation</h2>
        <span className={`status-chip ${complete ? "good" : ""}`}>
          {complete ? "Complete" : "In progress"}
        </span>
      </div>
      <p className="ag-recoupment-amount numeric">
        <strong>
          {money(recouped)} of {money(amount)} allocated toward the advance
        </strong>{" "}
        <span className="muted">
          · advance to {memberName(agreement, rules.advance.recipientId)}
        </span>
      </p>
      <ThinProgress value={recouped} max={amount} label="Advance allocation" />
      {children}
    </section>
  );
}

export interface PayoutRecord {
  user_id: string;
  amount: number;
  status: string;
}

export function MoneyCard({
  agreement,
  payouts,
  payoutsComplete,
  payoutsUnavailable,
  userId,
  footer,
}: {
  agreement: Agreement;
  payouts: OverviewPayout[];
  payoutsComplete: boolean;
  payoutsUnavailable: boolean;
  userId: string;
  footer?: ReactNode;
}) {
  const revenue = agreement.value.revenue;
  const allocations = revenue.flatMap((r) => r.allocations);
  const { receivedCents: received, paypalFeeCents: fees } =
    receivedTotals(revenue);
  const summary = overviewSummary(
    [agreement],
    payouts,
    userId,
    payoutsComplete,
  );
  const personal = summary.scope === "personal";
  const display = (value: number | null) =>
    value === null ? "Being checked" : money(value);
  const roster = agreement.value.members;
  const visibleMembers = personal
    ? roster.filter((m) => m.userId === userId)
    : roster;
  return (
    <aside className="panel ag-card ag-money" aria-label="Money">
      <h2>Money</h2>
      {payoutsUnavailable ? (
        <p className="muted" role="alert">
          Couldn't load payouts. Refresh to try again.
        </p>
      ) : !payoutsComplete ? (
        <p className="muted" role="status">
          Loading totals…
        </p>
      ) : (
        <>
          <dl className="ag-money-lines">
            <div>
              <dt title={RECEIVED_DEFINITION}>Received</dt>
              <dd className="numeric">{money(received)}</dd>
            </div>
            {fees > 0 && (
              <div>
                <dt>PayPal fee</dt>
                <dd className="numeric">{money(fees)}</dd>
              </div>
            )}
            <div>
              <dt>{personal ? "You're owed" : "Owed"}</dt>
              <dd className="numeric">{display(summary.allocated)}</dd>
            </div>
            <div>
              <dt>{personal ? "Paid to you" : "Paid"}</dt>
              <dd className="numeric">{display(summary.paid)}</dd>
            </div>
            <div className="ag-money-total">
              <dt>Still to pay</dt>
              <dd className="numeric">{display(summary.remaining)}</dd>
            </div>
          </dl>
          <p className="muted ag-money-note">
            {personal
              ? "Owed and paid are just yours. Received and the PayPal fee are for the whole agreement."
              : "Owed, not money in an account."}
          </p>
          <h3 className="ag-eyebrow">By person</h3>
          <ul className="ag-by-person">
            {visibleMembers.map((m) => {
              const owed = allocations
                .filter((a) => a.userId === m.userId)
                .reduce((t, a) => t + a.totalCents, 0);
              return (
                <li key={m.userId}>
                  <Avatar
                    name={m.displayName}
                    tone={toneInRoster(m.userId, roster)}
                    label={false}
                  />
                  <span>
                    <strong>{m.displayName}</strong>
                    <small className="muted numeric">{money(owed)} owed</small>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {footer}
    </aside>
  );
}
