import { sourceHighlights } from "../lib/source-highlights";
import { ChevronRightIcon } from "./icons";
import { HighlightedSource } from "./source-rule-context";
import { SplitRuleEditor } from "./split-rule-editor";
import { RuleImpactReview } from "./rule-impact-review";
import { isRulesDraftChange } from "../lib/rule-impact";
import { agreementEmptyState } from "../lib/agreement-empty-state";
import { formatDate, formatMoneyHeadline } from "../lib/preferences";
import { ClarificationDecisions } from "./clarification-decisions";
import { proposalQuestions } from "../lib/clarification-draft";
import { suggestedShares } from "../lib/ai-draft";
import { useEffect, useState, useRef, type ReactNode } from "react";
import {
  money,
  sampleAgreement,
  parseCents,
  parseShare,
  title,
  type Agreement,
  type Rules,
  type Revenue,
  type Allocation,
} from "../lib/model";
import { Badge, Button, Empty, Field, Notice } from "./ui";
import {
  PaymentGridStatus,
  payoutGridStatus,
} from "../src/components/paymentGridModel";
import { RECEIVED_DEFINITION, receivedTotals } from "../lib/received";
import { Avatar as ListAvatar, AvatarSize as ListAvatarSize } from "./person";
import {
  PENDING_USER_PREFIX,
  isPendingMember,
  type AgreementMember,
} from "../lib/agreement-api";
import { toneInRoster as listTone } from "../lib/person";
import { formatDay as listDay, formatExact as listExact } from "../lib/dates";
import { LogoMark } from "./logo-mark";
export function Logo() {
  return (
    <div className="logo">
      <LogoMark />
      Fairshare
    </div>
  );
}
export function Heading({
  title: heading,
  description,
  action,
  badge,
  small = false,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  badge?: ReactNode;
  small?: boolean;
}) {
  return (
    <header className={`heading ${small ? "compact" : ""}`}>
      <div>
        <div className="title-row">
          {small ? <h2>{heading}</h2> : <h1>{heading}</h1>}
          {badge}
        </div>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}
export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
export function SimpleForm({
  label,
  button,
  onSubmit,
  busy,
  type = "text",
}: {
  label: string;
  button: string;
  onSubmit: (v: string) => void;
  busy: boolean;
  type?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <Field label={label}>
        <input
          required
          type={type}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <Button disabled={busy || !value.trim()}>{button}</Button>
    </form>
  );
}
export { Auth } from "./designer-auth";

function PersonAvatar({ name }: { name: string }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <span className="person-avatar" title={name} aria-label={name}>
      {initials || "?"}
    </span>
  );
}
/** Status chip on the agreements list, in plain words. */
export enum ListStatus {
  NotSent = "Not sent yet",
  Waiting = "Waiting for approval",
  Approved = "Approved",
  NeedsAttention = "Needs attention",
}
const LIST_STATUS_TONE: Record<ListStatus, string> = {
  [ListStatus.NotSent]: "neutral",
  [ListStatus.Waiting]: "warning",
  [ListStatus.Approved]: "good",
  [ListStatus.NeedsAttention]: "danger",
};
function agreementStatus(a: Agreement, draft = false) {
  if (draft) return ListStatus.NotSent;
  if (a.value.reviewHold) return ListStatus.NeedsAttention;
  if (a.value.activeVersionId) return ListStatus.Approved;
  const latest = a.value.versions.at(-1);
  return !latest || latest.status === "DRAFT"
    ? ListStatus.NotSent
    : ListStatus.Waiting;
}
/** Changes to an approved agreement, said without version numbers. */
function pendingChange(status: string) {
  if (status === "AWAITING_APPROVAL") return "Changes waiting for approval";
  if (status === "DRAFT") return "Changes not sent yet";
  return "";
}

interface SplitPart {
  userId: string;
  name: string;
  firstName: string;
  basisPoints: number;
  tone: number;
  pending: boolean;
  you: boolean;
}
const percent = (basisPoints: number) => String(Math.round(basisPoints) / 100);

/** Who gets what, largest share first. Empty when the agreement has no rules yet. */
export function splitParts(a: Agreement, viewerId?: string): SplitPart[] {
  const active = a.value.versions.find((v) => v.id === a.value.activeVersionId);
  const shares = (active || a.value.versions.at(-1))?.rules.shares || [];
  const members = a.value.members as AgreementMember[];
  return shares
    .filter((share) => share.basisPoints >= 0)
    .map((share) => {
      const member = members.find((m) => m.userId === share.userId);
      const name = member?.displayName.trim() || "Someone";
      return {
        userId: share.userId,
        name,
        firstName: name.split(/\s+/)[0],
        basisPoints: share.basisPoints,
        tone: listTone(share.userId, members),
        pending:
          (member ? isPendingMember(member) : false) ||
          share.userId.startsWith(PENDING_USER_PREFIX),
        you: !!viewerId && share.userId === viewerId,
      };
    })
    .sort((x, y) => y.basisPoints - x.basisPoints);
}
const SPLIT_INLINE_LIMIT = 3;

/** "● Maya 50 · ● Jordan 30 · ● Riley 20"; past three people, the top two and "+N".
 * Hover or focus shows everyone with percentages. */
export function SplitSummary({
  parts,
  id,
}: {
  parts: SplitPart[];
  id: string;
}) {
  if (!parts.length)
    return (
      <span className="ag-split-none">
        <span aria-hidden="true">—</span>
        <span className="sr-only">No split yet</span>
      </span>
    );
  const single = parts.length === 1;
  const shown = parts.length > SPLIT_INLINE_LIMIT ? parts.slice(0, 2) : parts;
  const hidden = parts.length - shown.length;
  const tipId = `split-tip-${id}`;
  return (
    <span className="ag-split" tabIndex={0} aria-describedby={tipId}>
      <span className="ag-split-text">
        {shown.map((p, i) => (
          <span key={p.userId} className="ag-split-part">
            <span
              className={`ag-split-dot tone-${p.tone}`}
              aria-hidden="true"
            />
            <span
              className={
                [p.you && "ag-split-you", p.pending && "ag-split-pending"]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            >
              {p.firstName}
              {p.you ? " (you)" : ""} {percent(p.basisPoints)}
              {single ? "%" : ""}
            </span>
            {/* Trailing, so a wrapped line never starts with a dot. */}
            {i < shown.length - 1 && (
              <span className="ag-split-sep" aria-hidden="true">
                ·
              </span>
            )}
          </span>
        ))}
        {hidden > 0 && <span className="ag-split-more">+{hidden}</span>}
      </span>
      {!single && (
        <span className="ag-split-bar" aria-hidden="true">
          {parts.map((p) => (
            <span
              key={p.userId}
              className={`tone-${p.tone}`}
              style={{ flexGrow: p.basisPoints }}
            />
          ))}
        </span>
      )}
      <span className="ag-split-tip" role="tooltip" id={tipId}>
        {parts.map((p) => (
          <span key={p.userId} className="ag-split-tip-row">
            <span
              className={`ag-split-dot tone-${p.tone}`}
              aria-hidden="true"
            />
            <span className={p.you ? "ag-split-you" : undefined}>
              {p.name}
              {p.you ? " (you)" : ""}
            </span>
            {p.pending && (
              <span className="ag-split-pending"> · hasn’t joined yet</span>
            )}
            <span className="ag-split-tip-pct">{percent(p.basisPoints)}%</span>
          </span>
        ))}
      </span>
    </span>
  );
}
const PEOPLE_INLINE_LIMIT = 4;

export function AgreementList({
  agreements,
  onOpen,
  workspaceRole,
  isDraft = () => false,
  viewerId,
}: {
  workspaceRole?: string;
  agreements: Agreement[];
  onOpen: (a: Agreement) => void;
  /** Never-sent drafts: "Not sent yet" and "Finish setting up" instead of the chevron. */
  isDraft?: (a: Agreement) => boolean;
  /** The signed-in person; their share reads "(you)". */
  viewerId?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const filtered = agreements.filter(
    (a) =>
      a.value.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "All" || agreementStatus(a, isDraft(a)) === filter),
  );
  const emptyState = agreementEmptyState(workspaceRole);
  if (!agreements.length)
    return <Empty title={emptyState.title}>{emptyState.description}</Empty>;
  const lastUpdated = (a: Agreement) =>
    a.value.audit.reduce<string | undefined>(
      (latest, event) =>
        !latest || Date.parse(event.at) > Date.parse(latest)
          ? event.at
          : latest,
      undefined,
    );
  return (
    <section className="agreement-list ov-list-page" aria-label="Agreements">
      <div className="list-toolbar ov-toolbar">
        <label className="search-field ov-search">
          <span className="sr-only">Search agreements</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
          >
            <path
              d="m20 20-4.2-4.2M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="search"
            placeholder="Search agreements"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="agreement-status-filter ov-status-filter">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
          >
            <path
              d="M4 6h16M7 12h10m-7 6h4"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
          <span>Status:</span>
          <select
            aria-label="Filter agreements by status"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {["All", ...Object.values(ListStatus)].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {filtered.length ? (
        <div className="table-scroll ov-table ag-list-table">
          <table>
            <thead>
              <tr>
                <th className="ag-col-name">Agreement</th>
                <th className="ag-col-status">Status</th>
                <th className="ag-col-people">People</th>
                <th className="ag-col-split">Split</th>
                <th
                  className="numeric ag-col-received"
                  title={RECEIVED_DEFINITION}
                >
                  Received
                </th>
                <th className="ag-col-action">
                  <span className="sr-only">Open agreement</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const latest = a.value.versions.at(-1);
                const active = a.value.versions.find(
                  (v) => v.id === a.value.activeVersionId,
                );
                const members = a.value.members;
                const draft = isDraft(a);
                const status = agreementStatus(a, draft);
                const updated = lastUpdated(a);
                const change =
                  !draft && active && latest && active.id !== latest.id
                    ? pendingChange(latest.status)
                    : "";
                const extra = members.slice(PEOPLE_INLINE_LIMIT);
                const rowKey = JSON.stringify([a.workspaceId, a.id]);
                return (
                  <tr key={rowKey} className="ov-row" onClick={() => onOpen(a)}>
                    <td className="ag-col-name">
                      <button
                        className="text-button strong agreement-name"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(a);
                        }}
                      >
                        {a.value.name}
                      </button>
                      {(change || updated) && (
                        <div className="agreement-meta">
                          {change}
                          {change && updated ? " · " : ""}
                          {updated && (
                            <span title={listExact(updated)}>
                              Updated {listDay(updated)}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="ag-col-status">
                      <span
                        className={`status-chip ${LIST_STATUS_TONE[status]}`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="ag-col-people">
                      <div className="avatar-stack">
                        {members.slice(0, PEOPLE_INLINE_LIMIT).map((m) => (
                          <ListAvatar
                            key={m.userId}
                            name={m.displayName}
                            tone={listTone(m.userId, members)}
                            size={ListAvatarSize.SMALL}
                          />
                        ))}
                        {extra.length > 0 && (
                          <span
                            className="person-avatar size-sm ov-more"
                            title={extra.map((m) => m.displayName).join(", ")}
                            aria-label={`and ${extra.map((m) => m.displayName).join(", ")}`}
                          >
                            +{extra.length}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="ag-col-split">
                      <SplitSummary
                        parts={splitParts(a, viewerId)}
                        id={`${a.workspaceId}-${a.id}`.replace(/[^\w-]/g, "_")}
                      />
                    </td>
                    <td className="numeric ag-col-received">
                      {draft ? (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">Nothing received</span>
                        </>
                      ) : (
                        formatMoneyHeadline(
                          receivedTotals(a.value.revenue).receivedCents,
                        )
                      )}
                    </td>
                    {draft ? (
                      <td className="ov-draft-cell ag-col-action">
                        <Button
                          variant="secondary"
                          aria-label={`Finish setting up ${a.value.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(a);
                          }}
                        >
                          Finish setting up
                        </Button>
                      </td>
                    ) : (
                      <td
                        className="ov-chevron-cell ag-col-action"
                        aria-hidden="true"
                      >
                        <span className="ov-chevron">
                          <ChevronRightIcon />
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="ov-no-results">
          <Empty
            title="No matching agreements"
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setFilter("All");
                }}
              >
                Clear filters
              </Button>
            }
          >
            Nothing matches {query ? `“${query}”` : "this filter"}
            {filter !== "All" ? ` with status ${filter}` : ""}.
          </Empty>
        </div>
      )}
    </section>
  );
}
export function SplitTable({
  agreement,
  rules,
}: {
  agreement: Agreement;
  rules: Rules;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Person</th>
          <th className="numeric">Share</th>
        </tr>
      </thead>
      <tbody>
        {rules.shares.map((s) => (
          <tr key={s.userId}>
            <td>
              <span className="person-cell">
                <PersonAvatar
                  name={
                    agreement.value.members.find((m) => m.userId === s.userId)
                      ?.displayName || "Participant"
                  }
                />
                {agreement.value.members.find((m) => m.userId === s.userId)
                  ?.displayName || "Participant"}
              </span>
            </td>
            <td className="numeric strong">{s.basisPoints / 100}%</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th>Total</th>
          <td className="numeric strong">
            {rules.shares.reduce(
              (total, share) => total + share.basisPoints,
              0,
            ) / 100}
            %
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
export function RevenueTable({
  agreement,
  onOpen,
}: {
  agreement: Agreement;
  onOpen: (r: Revenue) => void;
}) {
  return agreement.value.revenue.length ? (
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th className="numeric">Received</th>
          <th className="numeric">PayPal fee</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {agreement.value.revenue.map((r) => (
          <tr key={r.providerCaptureId}>
            <td>{formatDate(r.at)}</td>
            <td className="numeric">{money(r.grossCents)}</td>
            <td className="numeric">{money(r.feeCents)}</td>
            <td>
              <Badge value={r.status} />
            </td>
            <td>
              <button className="text-button" onClick={() => onOpen(r)}>
                View breakdown
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <Empty title="No payments yet">
      Payments show up here once PayPal confirms them.
    </Empty>
  );
}
export function AllocationTable({
  allocations,
  agreement,
}: {
  allocations: Allocation[];
  agreement: Agreement;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Person</th>
          <th className="numeric">Advance payback</th>
          <th className="numeric">Share</th>
          <th className="numeric">Fee</th>
          <th className="numeric">Total owed</th>
        </tr>
      </thead>
      <tbody>
        {allocations.map((a) => (
          <tr key={a.userId}>
            <td>
              <span className="person-cell">
                <PersonAvatar
                  name={
                    agreement.value.members.find((m) => m.userId === a.userId)
                      ?.displayName || "Participant"
                  }
                />
                {agreement.value.members.find((m) => m.userId === a.userId)
                  ?.displayName || "Participant"}
              </span>
            </td>
            <td className="numeric">{money(a.recoupmentCents)}</td>
            <td className="numeric">{money(a.shareCents)}</td>
            <td className="numeric">{money(a.feeCents)}</td>
            <td className="numeric strong">{money(a.totalCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export function PreviewForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (a: number, b: number) => void;
}) {
  const [err, setErr] = useState("");
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const f = new FormData(e.currentTarget);
          onSubmit(
            parseCents(String(f.get("gross"))),
            parseCents(String(f.get("fee"))),
          );
          setErr("");
        } catch (e) {
          setErr((e as Error).message);
        }
      }}
    >
      <Field label="Payment amount ($)">
        <input name="gross" defaultValue="3000" inputMode="decimal" required />
      </Field>
      <Field label="PayPal fee ($)">
        <input name="fee" defaultValue="0" inputMode="decimal" required />
      </Field>
      <Button disabled={busy} variant="secondary">
        Preview split
      </Button>
      {err && <p role="alert">{err}</p>}
    </form>
  );
}
export function PasswordForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (a: string, b: string) => void;
}) {
  return (
    <form
      className="section"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSubmit(String(f.get("old")), String(f.get("new")));
      }}
    >
      <h3>Change password</h3>
      <Field label="Current password">
        <input
          name="old"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label="New password">
        <input
          name="new"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </Field>
      <Button disabled={busy}>Change password and sign out</Button>
    </form>
  );
}
export function AIReview({
  busy,
  extraction,
  onExtract,
}: {
  busy: boolean;
  extraction: any;
  onExtract: () => void;
}) {
  const [consent, setConsent] = useState(false);
  return (
    <section className="section">
      <h3>Read the agreement</h3>
      <p className="muted">
        Suggestions are not active rules. Check every interpretation against the
        original agreement before sharing it with everyone.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        I authorize Fairshare to send this agreement to Cloudflare AI to suggest
        terms, with Anthropic as an optional fallback if configured.
      </label>
      <Button
        variant="secondary"
        disabled={busy || !consent}
        onClick={onExtract}
      >
        Suggest terms
      </Button>
      <p className="visually-hidden" role="status">
        {extraction
          ? "Suggestions ready. Review the extracted terms before using them."
          : ""}
      </p>
      {extraction && (
        <div className="panel">
          <Badge value={extraction.status || "REVIEW_REQUIRED"} />
          <h4>Suggested terms</h4>
          {extraction.reason && (
            <Notice warning>
              We couldn’t suggest all the terms. You can try again or add them
              yourself below. Your agreement hasn’t changed.
            </Notice>
          )}
          {extraction.facts?.map((fact: any, i: number) => (
            <div className="observation rule-card" key={i}>
              <div className="rule-card-heading">
                <span className="rule-number">{i + 1}</span>
                <strong>
                  {fact.subject} · {title(fact.kind)}
                </strong>
              </div>
              <p>{fact.rawValue}</p>
              {fact.citation?.quote && (
                <blockquote className="source-quote">
                  <span>Source clause</span>
                  <p>{fact.citation.quote}</p>
                </blockquote>
              )}
            </div>
          ))}
          {extraction.issues?.map((issue: any, i: number) => (
            <Notice warning key={i}>
              <strong>{title(issue.kind)}</strong>
              <p>{issue.question}</p>
              {issue.citation && (
                <small>Source: “{issue.citation.quote}”</small>
              )}
            </Notice>
          ))}
          <small>
            {extraction.provider
              ? `Provider: ${extraction.provider} · ${extraction.model}`
              : "Manual review required"}
          </small>
          <p className="muted">
            Check and edit the terms below. AI never activates or approves a
            version.
          </p>
        </div>
      )}
    </section>
  );
}
export function RulesEditor({
  agreement,
  source,
  documentId,
  busy,
  extraction,
  onSave,
  onDirty,
  onReviewPeople,
}: {
  agreement: Agreement;
  source: string;
  documentId: string;
  busy: boolean;
  extraction?: unknown;
  onSave: (r: Rules) => void;
  onDirty?: () => void;
  onReviewPeople?: () => void;
}) {
  const highlights = sourceHighlights(extraction, documentId, source);
  const [selectedCitation, setSelectedCitation] = useState<string | null>(null);
  const [splitDraft, setSplitDraft] = useState<Record<string, string> | null>(
    null,
  );
  const selectedFact = highlights.find((fact) => fact.id === selectedCitation);
  const splitOpenerRef = useRef<HTMLElement | null>(null);
  const splitWasOpen = useRef(false);
  function closeSplitEditor() {
    setSplitDraft(null);
  }
  function editSplit(opener: HTMLElement) {
    if (!formRef.current) return;
    splitOpenerRef.current = opener;
    const fields = new FormData(formRef.current);
    setSplitDraft(
      Object.fromEntries(
        agreement.value.members.map((member) => [
          member.userId,
          String(fields.get(member.userId) ?? ""),
        ]),
      ),
    );
  }
  const [draftRevision, setDraftRevision] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const splitDrawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (splitWasOpen.current && !splitDraft) {
      splitOpenerRef.current?.focus({ preventScroll: true });
      splitOpenerRef.current = null;
    }
    splitWasOpen.current = !!splitDraft;
  }, [splitDraft]);
  useEffect(() => {
    setSplitDraft(null);
  }, [agreement.revision]);
  const [prefilled, setPrefilled] = useState(false);
  const suggestions = suggestedShares(
    extraction,
    documentId,
    source,
    agreement.value.members,
  );
  const old = agreement.value.versions.at(-1)?.rules;
  const [error, setError] = useState(""),
    [fee, setFee] = useState(old?.feePolicy || "BEFORE_SPLIT"),
    [advance, setAdvance] = useState(!!old?.advance),
    [origin, setOrigin] = useState(old?.source.origin || "HUMAN_PROPOSAL");
  return (
    <div className="source-rules-review">
      <aside
        className="review-source panel"
        aria-label="Saved agreement source"
      >
        <h3>Source agreement</h3>
        <p className="muted">
          Compare each proposed term with the saved text. This is extracted
          text; Document shows its saved provenance and any retained original
          file.
        </p>
        <p className="muted">
          Select a highlighted clause to review its extracted term on the right.
          Source text is read-only.
        </p>
        {source ? (
          <HighlightedSource
            source={source}
            highlights={highlights}
            selected={selectedCitation}
            onSelect={setSelectedCitation}
          />
        ) : (
          <p>
            No saved source text. Add the agreement document before proposing
            rules.
          </p>
        )}
        {!highlights.length && (
          <small>
            No validated citation ranges are available yet. The source remains
            unchanged.
          </small>
        )}
      </aside>
      <form
        ref={formRef}
        inert={busy}
        onChange={(event) => {
          if (isRulesDraftChange(event.target)) onDirty?.();
        }}
        onChangeCapture={(event) => {
          if (isRulesDraftChange(event.target))
            setDraftRevision((value) => value + 1);
        }}
        className="section rules-editor"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const f = new FormData(e.currentTarget);
            if (
              !agreement.value.versions.length &&
              f.get("rosterConfirmed") !== "on"
            )
              throw new Error(
                "Confirm everyone is included before saving the first proposal.",
              );
            const shares = agreement.value.members.map((m) => ({
              userId: m.userId,
              basisPoints: parseShare(String(f.get(m.userId))),
            }));
            if (shares.reduce((s, v) => s + v.basisPoints, 0) !== 10000)
              throw new Error("Shares must add up to exactly 100%.");
            const ref = {
              origin,
              documentId,
              clause: String(f.get("clause")),
              excerpt: String(f.get("excerpt")),
            };
            if (origin === "SOURCE_CLAUSE" && !source.includes(ref.excerpt))
              throw new Error(
                "The quoted text must appear exactly in your saved agreement.",
              );
            const rules: Rules = {
              currency: "USD",
              shares,
              feePolicy: fee,
              ...(fee === "ORGANIZER_SHARE"
                ? {
                    feeBearerId: agreement.value.members.find(
                      (m) => m.role === "ORGANIZER",
                    )!.userId,
                  }
                : {}),
              source: ref,
              unresolvedQuestions: proposalQuestions(
                String(f.get("questions") || ""),
                extraction,
                documentId,
                new Set(f.getAll("resolvedAiQuestion").map(String)),
              ),
            };
            if (advance) {
              const id = old?.advance?.id || crypto.randomUUID();
              const recipientId = String(f.get("recipient"));
              const amountCents = parseCents(String(f.get("advance")));
              const advanceSource =
                old?.advance &&
                old.advance.id === id &&
                old.advance.recipientId === recipientId &&
                old.advance.amountCents === amountCents
                  ? old.advance.source
                  : ref;
              rules.advance = {
                id,
                recipientId,
                amountCents,
                verified: f.get("verified") === "on",
                source: advanceSource,
              };
            }
            onSave(rules);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <h3>Proposed rules</h3>
        {highlights.length > 0 && (
          <div
            className="source-citation-links"
            aria-label="Source-backed terms"
          >
            {highlights.map((fact) => (
              <Button
                key={fact.id}
                type="button"
                variant="quiet"
                onClick={() => setSelectedCitation(fact.id)}
              >
                {fact.label} · {title(fact.kind)}
              </Button>
            ))}
          </div>
        )}
        {selectedFact && (
          <section className="panel" aria-label="Selected source clause">
            <h4>
              {selectedFact.label} · {title(selectedFact.kind)}
            </h4>
            <blockquote>{selectedFact.quote}</blockquote>
            <p>Original extraction: {selectedFact.rawValue}</p>
            <p className="muted">
              The quote is from your saved source. Editing proposed terms never
              changes it.
            </p>
            {selectedFact.kind === "SHARE" && (
              <Button
                type="button"
                variant="secondary"
                disabled={!!splitDraft}
                onClick={(event) => editSplit(event.currentTarget)}
              >
                Edit proposed split
              </Button>
            )}
          </section>
        )}
        {splitDraft && (
          <div className="rule-editor-drawer-backdrop">
            <aside
              ref={splitDrawerRef}
              className="rule-editor-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Edit revenue split"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeSplitEditor();
                  return;
                }
                if (event.key !== "Tab") return;
                const items = [
                  ...(splitDrawerRef.current?.querySelectorAll<HTMLElement>(
                    "input:not([disabled]), button:not([disabled]), summary, [tabindex='0']",
                  ) ?? []),
                ];
                if (!items.length) return;
                const first = items[0];
                const last = items.at(-1)!;
                if (!items.includes(document.activeElement as HTMLElement)) {
                  event.preventDefault();
                  (event.shiftKey ? last : first).focus();
                } else if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }}
            >
              <SplitRuleEditor
                members={agreement.value.members}
                values={splitDraft}
                original={highlights
                  .filter((fact) => fact.kind === "SHARE")
                  .map(
                    (fact) => `${fact.label}: ${fact.rawValue} — ${fact.quote}`,
                  )}
                onFocusMember={(name) => {
                  const fact = highlights.find(
                    (item) =>
                      item.kind === "SHARE" &&
                      item.label.trim().toLowerCase() ===
                        name.trim().toLowerCase(),
                  );
                  if (fact) setSelectedCitation(fact.id);
                }}
                onCancel={closeSplitEditor}
                onApply={(values) => {
                  for (const [id, value] of Object.entries(values)) {
                    const input = formRef.current?.elements.namedItem(id);
                    if (input instanceof HTMLInputElement) input.value = value;
                  }
                  setOrigin("HUMAN_PROPOSAL");
                  const excerpt =
                    formRef.current?.elements.namedItem("excerpt");
                  if (excerpt instanceof HTMLTextAreaElement) {
                    const proposal = `Proposed split clarification: ${agreement.value.members.map((member) => `${member.displayName} ${values[member.userId]}%`).join(", ")}.`;
                    excerpt.value =
                      `${excerpt.value.replace(/\n?Proposed split clarification:[^\n]*/g, "").trim()}\n${proposal}`.trim();
                  }
                  onDirty?.();
                  setDraftRevision((value) => value + 1);
                  closeSplitEditor();
                }}
              />
            </aside>
          </div>
        )}
        <Button
          type="button"
          variant="secondary"
          disabled={!!splitDraft}
          onClick={(event) => editSplit(event.currentTarget)}
        >
          Edit revenue split
        </Button>
        {source.trim() === sampleAgreement && (
          <Notice warning>
            <strong>Sample text is not your participants’ agreement.</strong>
            <p>
              This example names Maya, Jordan and Riley. Your current
              participants are{" "}
              {agreement.value.members
                .map((member) => member.displayName)
                .join(", ")}
              . Check that each person corresponds to a party in the source
              before proposing terms.
            </p>
            <p>
              Add the correct people in People, or replace this text with their
              agreement. The percentages below are editable defaults, not
              extracted or approved terms. Check the shares, advance and fees
              against the source; everyone must review and approve the proposal.
            </p>
          </Notice>
        )}
        <p className="muted">
          All participants review this version. Add people first; membership is
          locked once a proposal exists.
        </p>
        {!agreement.value.versions.length && (
          <section
            className="panel"
            aria-label="Confirm agreement participants"
          >
            <h4>Is everyone included?</h4>
            <p>
              This proposal will include{" "}
              {agreement.value.members
                .map((member) => member.displayName)
                .join(", ")}
              . Once saved, people cannot be added to this agreement, even in a
              revised version.
            </p>
            {agreement.value.members.length === 1 && (
              <p>
                Only you are included. If the document names other parties, add
                them in People before continuing. A one-person agreement is
                allowed when that is intentional.
              </p>
            )}
            {onReviewPeople && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={onReviewPeople}
              >
                Review or add people
              </Button>
            )}
            <label className="check">
              <input
                key={agreement.value.members
                  .map((member) => member.userId)
                  .join(":")}
                type="checkbox"
                name="rosterConfirmed"
                required
              />
              Everyone who needs a share or approval is included.
            </label>
          </section>
        )}
        {Object.keys(suggestions).length > 0 && (
          <Notice>
            <p>
              AI found source-backed shares for{" "}
              {Object.keys(suggestions).length} people. Copy them into this
              draft, then check every value and complete any missing terms.
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                for (const [id, value] of Object.entries(suggestions)) {
                  const input = formRef.current?.elements.namedItem(id);
                  if (input instanceof HTMLInputElement) input.value = value;
                }
                onDirty?.();
                setPrefilled(true);
                setDraftRevision((value) => value + 1);
              }}
            >
              Use suggested shares
            </Button>
            {prefilled && (
              <p role="status">
                Shares copied into the draft. Nothing has been saved or
                approved. Review them before saving.
              </p>
            )}
          </Notice>
        )}
        {error && (
          <Notice warning announcement="assertive">
            {error}
          </Notice>
        )}
        <div className="form-grid">
          {agreement.value.members.map((m) => (
            <Field key={m.userId} label={`${m.displayName} · share %`}>
              <input
                name={m.userId}
                required
                inputMode="decimal"
                defaultValue={
                  old?.shares.find((s) => s.userId === m.userId)
                    ?.basisPoints !== undefined
                    ? String(
                        old.shares.find((s) => s.userId === m.userId)!
                          .basisPoints / 100,
                      )
                    : agreement.value.members.length === 1
                      ? "100"
                      : ""
                }
              />
            </Field>
          ))}
        </div>
        <fieldset>
          <legend>How should processing fees be handled?</legend>
          <label className="choice">
            <input
              type="radio"
              name="feePolicy"
              checked={fee === "BEFORE_SPLIT"}
              onChange={() => setFee("BEFORE_SPLIT")}
            />
            <span>
              <strong>Share fees proportionally</strong>
              <small>
                Fees are deducted before recoupment and splitting, reducing
                everyone’s allocation.
              </small>
            </span>
          </label>
          <label className="choice">
            <input
              type="radio"
              name="feePolicy"
              checked={fee === "ORGANIZER_SHARE"}
              onChange={() => setFee("ORGANIZER_SHARE")}
            />
            <span>
              <strong>Organizer covers fees</strong>
              <small>
                Deduct fees from the organizer’s allocation. If it cannot cover
                them, the payment needs review.
              </small>
            </span>
          </label>
        </fieldset>
        <label className="check">
          <input
            type="checkbox"
            checked={advance}
            onChange={(e) => setAdvance(e.target.checked)}
          />
          Recoup an existing advance before splitting
        </label>
        {advance && (
          <div className="panel">
            <div className="form-grid">
              <Field label="Advance (USD)">
                <input
                  name="advance"
                  required
                  defaultValue={
                    old?.advance ? String(old.advance.amountCents / 100) : ""
                  }
                />
              </Field>
              <Field label="Who receives recoupment?">
                <select
                  name="recipient"
                  defaultValue={old?.advance?.recipientId}
                >
                  {agreement.value.members.map((m) => (
                    <option value={m.userId} key={m.userId}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="check">
              <input
                type="checkbox"
                name="verified"
                defaultChecked={old?.advance?.verified}
              />
              I have verified that this prior advance and outstanding amount are
              correct.
            </label>
            <small>
              Uploading an agreement does not prove an advance was paid.
            </small>
          </div>
        )}
        <RuleImpactReview
          agreement={agreement}
          formRef={formRef}
          advance={advance}
          revision={draftRevision}
          onChoose={(policy) => {
            setFee(policy);
            setOrigin("HUMAN_PROPOSAL");
            const excerpt = formRef.current?.elements.namedItem("excerpt");
            if (excerpt instanceof HTMLTextAreaElement) {
              const proposal =
                policy === "BEFORE_SPLIT"
                  ? "Proposed fee clarification: deduct PayPal processing fees before recoupment and splitting."
                  : "Proposed fee clarification: recoup and split gross revenue, then deduct PayPal processing fees from the organizer's allocation. Hold for review if that allocation cannot cover the fee.";
              excerpt.value =
                `${excerpt.value.replace(/\n?Proposed fee clarification:[^\n]*/g, "").trim()}\n${proposal}`.trim();
            }
            onDirty?.();
            setDraftRevision((value) => value + 1);
          }}
        />
        <Field label="Rule provenance">
          <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="HUMAN_PROPOSAL">
              Human proposal for everyone to review
            </option>
            <option value="SOURCE_CLAUSE">Exact source clause</option>
          </select>
        </Field>
        <Field label="Clause or proposal title">
          <input
            name="clause"
            required
            defaultValue={old?.source.clause || "Revenue sharing proposal"}
          />
        </Field>
        <Field
          label={
            origin === "SOURCE_CLAUSE"
              ? "Exact quote from agreement"
              : "Proposed clarification"
          }
        >
          <textarea
            name="excerpt"
            required
            rows={3}
            defaultValue={old?.source.excerpt || ""}
          />
        </Field>
        <ClarificationDecisions
          extraction={extraction}
          documentId={documentId}
        />
        <Field
          label="Unresolved questions"
          hint="One per line. Any unresolved question blocks sending for approval."
        >
          <textarea
            name="questions"
            rows={2}
            defaultValue={old?.unresolvedQuestions.join("\n")}
          />
        </Field>
        <Notice>
          Saving creates a new version. It does not legally amend the source
          contract or authorize a payout.
        </Notice>
        {splitDraft && (
          <p role="status">
            Apply or cancel your split edit before saving the proposal.
          </p>
        )}
        <Button disabled={busy || !!splitDraft}>Save proposal</Button>
      </form>
    </div>
  );
}
export function safePayPalUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "www.sandbox.paypal.com";
  } catch {
    return false;
  }
}

/** Kept for existing callers; the mapping lives with the grid model. */
export function payoutStatus(status: string): PaymentGridStatus {
  return payoutGridStatus(status);
}
