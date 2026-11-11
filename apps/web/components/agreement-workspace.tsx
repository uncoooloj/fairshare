"use client";
import { useRef, useState, type ReactNode } from "react";
import { money, type Agreement, type Rules, type Version } from "../lib/model";
import { formatMoneyHeadline } from "../lib/preferences";
import { statusLabel } from "../lib/status-labels";
import {
  CitationId,
  OPEN_CITATION_EVENT,
  type OpenCitationDetail,
} from "../lib/document-citations";
import { formatDay, formatExact } from "../lib/dates";
import { toneInRoster } from "../lib/person";
import { RECEIVED_DEFINITION, receivedTotals } from "../lib/received";
import { Avatar, AvatarSize } from "./person";
import { overviewSummary, type OverviewPayout } from "../lib/overview-summary";
import {
  agreementStatus,
  StageAction,
  type AgreementStatus,
} from "../lib/agreement-status";
import { Button } from "./ui";
import { ActionMenu, type MenuItem } from "./action-menu";

export enum RuleKind {
  Fees = "PayPal fee",
  Advance = "Advance paid back first",
  Split = "Split",
}

/** Where a rule came from: a clause in the document, or typed by the team. */
interface StepSource {
  origin: string;
  clause: string;
  citation: CitationId;
  versionId: number;
  documentId: string;
}

interface StepPerson {
  userId: string;
  name: string;
  basisPoints?: number;
}

interface RuleStep {
  kind: RuleKind;
  sentence: string;
  /** Empty means the rule applies to everyone. */
  people: StepPerson[];
  source?: StepSource;
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

/** Calendar dates (YYYY-MM-DD) read the same in every time zone. */
function calendarDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Steps follow the order the engine applies them: fees, advance, split. */
function ruleSteps(
  agreement: Agreement,
  rules: Rules,
  versionId: number,
): RuleStep[] {
  const steps: RuleStep[] = [];
  const beforeSplit = rules.feePolicy === "BEFORE_SPLIT";
  if (beforeSplit)
    steps.push({
      kind: RuleKind.Fees,
      sentence: "PayPal's fee comes off first.",
      people: [],
    });
  if (rules.advance) {
    const name = memberName(agreement, rules.advance.recipientId);
    steps.push({
      kind: RuleKind.Advance,
      sentence: `${name} gets their ${formatMoneyHeadline(
        rules.advance.amountCents,
      )} advance back before any split.`,
      people: [{ userId: rules.advance.recipientId, name }],
      source: {
        ...rules.advance.source,
        citation: CitationId.Advance,
        versionId,
        documentId: rules.advance.source.documentId,
      },
    });
  }
  const shares = rules.shares.map((s) => ({
    userId: s.userId,
    name: memberName(agreement, s.userId),
    basisPoints: s.basisPoints,
  }));
  steps.push({
    kind: RuleKind.Split,
    sentence:
      shares.length === 1
        ? `${shares[0].name} gets ${percent(shares[0].basisPoints)}${
            rules.advance ? " of the rest" : ""
          }.`
        : `${rules.advance ? "The rest is" : "Each payment is"} split ${shares
            .map((s) => s.basisPoints / 100)
            .join(" / ")}.`,
    people: shares,
    source: {
      ...rules.source,
      citation: CitationId.Rules,
      versionId,
      documentId: rules.source.documentId,
    },
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

function currentAgreementDates(agreement: Agreement) {
  const details = agreement.value.details;
  const from = details?.effectiveFrom;
  const to = details?.effectiveTo;
  if (from === undefined && to === undefined) return undefined;
  return {
    start: from ? calendarDay(from) : "Not recorded",
    end: to === null ? "No end date" : to ? calendarDay(to) : "Not recorded",
  };
}

function CurrentAgreementDetails({ agreement }: { agreement: Agreement }) {
  const dates = currentAgreementDates(agreement);
  if (!dates) return null;
  return (
    <section
      className="ag-current-details"
      aria-label="Current agreement dates"
    >
      <h3>Current agreement dates</h3>
      <dl>
        <div>
          <dt>Start</dt>
          <dd>{dates.start}</dd>
        </div>
        <div>
          <dt>End</dt>
          <dd>{dates.end}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Ask the document below to show a clause; scroll to it if it can't. */
function openClause(detail: OpenCitationDetail) {
  const event = new CustomEvent(OPEN_CITATION_EVENT, {
    detail,
    cancelable: true,
  });
  if (window.dispatchEvent(event))
    document
      .getElementById("agreement-document")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function DocumentIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

/** The clause a rule came from, or a quiet note that the team typed it. */
function SourceChip({ source }: { source?: StepSource }) {
  if (!source) return null;
  if (source.origin === "HUMAN_PROPOSAL")
    return <span className="ag-rule-source is-team">Added by the team</span>;
  const clause = source.clause.replace(/^(clause|section|§)\s*/i, "").trim();
  if (!clause) return null;
  return (
    <button
      type="button"
      className="ag-rule-source"
      aria-label={`Clause ${clause}: show it in the document`}
      onClick={() =>
        openClause({
          id: source.citation,
          versionId: source.versionId,
          documentId: source.documentId,
        })
      }
    >
      <DocumentIcon />
      {clause}
    </button>
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

function RuleSteps({
  agreement,
  steps,
  id,
}: {
  agreement: Agreement;
  steps: RuleStep[];
  id: string;
}) {
  const roster = agreement.value.members;
  return (
    <ol className="ag-rules" id={id}>
      {steps.map((step, index) => (
        <li key={`${step.kind}:${index}`} className="ag-rule">
          <span className="ag-rule-number" aria-hidden="true">
            {index + 1}
          </span>
          <div className="ag-rule-body">
            <p className="ag-rule-label">{step.kind}</p>
            <p className="ag-rule-sentence">{step.sentence}</p>
            {step.people.length ? (
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
                    {p.basisPoints !== undefined &&
                      ` ${percent(p.basisPoints)}`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ag-rule-everyone">Everyone</p>
            )}
          </div>
          <SourceChip source={step.source} />
        </li>
      ))}
    </ol>
  );
}

/** One card with every rule a payment runs through, in order. */
export function RevenueRulesCard({
  agreement,
  version,
  headingId,
  action,
}: {
  agreement: Agreement;
  version: Version;
  /** Focus lands here after saving new rules. */
  headingId?: string;
  action?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const steps = ruleSteps(agreement, version.rules, version.id);
  const inUse = version.id === agreement.value.activeVersionId;
  const listId = `revenue-rules-${version.id}`;
  return (
    <section
      className="panel ag-card ag-rules-card"
      aria-labelledby={headingId ?? `${listId}-title`}
    >
      <div className="ag-rules-head">
        <div className="ag-rules-title">
          <div className="ag-title">
            <h2 id={headingId ?? `${listId}-title`} tabIndex={-1}>
              Revenue rules
            </h2>
            <span className={`status-chip ${inUse ? "good" : ""}`}>
              {inUse ? "In use" : statusLabel(version.status)}
            </span>
          </div>
          <p>Every payment runs through these steps, in order.</p>
        </div>
        <div className="ag-rules-actions">
          {action}
          <button
            type="button"
            className="ag-rules-toggle"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-label={open ? "Hide revenue rules" : "Show revenue rules"}
            onClick={() => setOpen((value) => !value)}
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={open ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
            </svg>
          </button>
        </div>
      </div>
      {open ? (
        <RuleSteps agreement={agreement} steps={steps} id={listId} />
      ) : (
        <div className="ag-rules-summary">
          <span>
            {steps.length} {steps.length === 1 ? "rule" : "rules"}:
          </span>
          {steps.map((step, index) => (
            <span key={`${step.kind}:${index}`} className="ag-rule-tag">
              {step.kind === RuleKind.Split && step.people.length > 1
                ? `Split ${step.people
                    .map((p) => (p.basisPoints || 0) / 100)
                    .join(" / ")}`
                : step.kind}
            </span>
          ))}
        </div>
      )}
      <CurrentAgreementDetails agreement={agreement} />
    </section>
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
        : status.action === StageAction.GetPaid
          ? "Get paid"
          : "";
  return (
    <div
      className={`ag-status ${status.tone ? `is-${status.tone}` : ""}`}
      role="status"
    >
      <span className="ag-status-dot" aria-hidden="true" />
      <p className="ag-status-line">{status.line}</p>
      {label && (
        <Button
          variant={
            status.action === StageAction.SeeRequest ? "secondary" : "primary"
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
}) {
  const menuButton = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState(false);
  const status = agreementStatus(agreement, userId);
  const meta = versionMeta(agreement);
  const menuItems: MenuItem[] = [
    ...(rename
      ? [
          {
            id: "rename",
            label: "Edit agreement name",
            onSelect: () => setRenaming(true),
          },
        ]
      : []),
    { id: "payouts", label: "View payouts", onSelect: onViewPayouts },
  ];
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
        <ActionMenu
          ref={menuButton}
          label="Agreement actions"
          items={menuItems}
        />
      </div>
      <StatusLine status={status} onAction={onStatusAction} />
      {rename &&
        (renaming || renameSuggested) &&
        rename(renaming, () => {
          setRenaming(false);
          menuButton.current?.focus();
        })}
    </header>
  );
}

/** How much of the advance has been allocated, below the rules. */
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
  const recouped = Math.min(
    agreement.value.recoupedByAdvance[rules.advance.id] || 0,
    amount,
  );
  const complete = amount > 0 && recouped >= amount;
  const name = memberName(agreement, rules.advance.recipientId);
  const split =
    rules.shares.length > 1
      ? `splits ${rules.shares.map((s) => s.basisPoints / 100).join(" / ")}`
      : `goes to ${memberName(agreement, rules.shares[0]?.userId ?? "")}`;
  return (
    <section className="panel ag-card ag-recoupment">
      <div className="ag-card-head">
        <h2>Advance allocation</h2>
        <span className={`status-chip ${complete ? "good" : ""}`}>
          {complete ? "Fully allocated" : "In progress"}
        </span>
      </div>
      <p className="ag-recoupment-amount numeric">
        {formatMoneyHeadline(recouped)} of {formatMoneyHeadline(amount)}{" "}
        allocated toward the advance
      </p>
      <ThinProgress value={recouped} max={amount} label="Advance allocation" />
      <p className="ag-recoupment-note">
        {complete
          ? `The full ${formatMoneyHeadline(amount)} advance amount has been allocated. Every payment now ${split}.`
          : `${formatMoneyHeadline(amount - recouped)} left to allocate toward ${name}'s advance before the split.`}
        {!rules.advance.verified && " The advance amount isn't confirmed yet."}
      </p>
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
