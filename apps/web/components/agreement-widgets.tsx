import { ClarificationDecisions } from "./clarification-decisions";
import { proposalQuestions } from "../lib/clarification-draft";
import { suggestedShares } from "../lib/ai-draft";
import { useState, useRef, type ReactNode } from "react";
import {
  money,
  parseCents,
  parseShare,
  title,
  type Agreement,
  type Rules,
  type Revenue,
  type Allocation,
} from "../lib/model";
import { Badge, Button, Empty, Field, Notice } from "./ui";
import { PaymentGridStatus } from "../src/components/paymentGridModel";
export function Logo() {
  return (
    <div className="logo">
      <span aria-hidden="true">▰</span>Fairshare
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
function agreementStatus(a: Agreement) {
  if (a.value.reviewHold) return "Needs attention";
  if (a.value.activeVersionId) return "Approved";
  const status = a.value.versions.at(-1)?.status || "DRAFT";
  return status === "DRAFT" ? "Draft" : "In review";
}
export function AgreementList({
  agreements,
  onOpen,
}: {
  agreements: Agreement[];
  onOpen: (a: Agreement) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const filtered = agreements.filter(
    (a) =>
      a.value.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "All" || agreementStatus(a) === filter),
  );
  if (!agreements.length)
    return (
      <Empty title="Your first agreement starts here">
        Create an agreement, bring in your collaborators and make the split
        clear before money comes in.
      </Empty>
    );
  return (
    <section className="agreement-list" aria-label="Agreements">
      <div className="list-toolbar">
        <label className="search-field">
          <span className="sr-only">Search agreements</span>
          <input
            type="search"
            placeholder="Search agreements"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div
          className="filter-tabs"
          role="group"
          aria-label="Filter agreements by status"
        >
          {["All", "Draft", "In review", "Approved", "Needs attention"].map(
            (value) => (
              <button
                key={value}
                type="button"
                className={filter === value ? "selected" : ""}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value}
              </button>
            ),
          )}
        </div>
      </div>
      {filtered.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Agreement</th>
                <th>Status</th>
                <th>People</th>
                <th>Split</th>
                <th className="numeric">Received</th>
                <th>
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
                const shares = (active || latest)?.rules.shares;
                return (
                  <tr key={a.id}>
                    <td>
                      <button
                        className="text-button strong agreement-name"
                        onClick={() => onOpen(a)}
                      >
                        {a.value.name}
                      </button>
                      <div className="agreement-meta">
                        {active
                          ? `v${active.id} active`
                          : latest
                            ? `v${latest.id}`
                            : "No proposed terms"}
                        {active && latest && active.id !== latest.id
                          ? ` · v${latest.id} ${title(latest.status)}`
                          : ""}
                      </div>
                    </td>
                    <td>
                      <Badge
                        value={
                          a.value.reviewHold
                            ? "REVIEW_REQUIRED"
                            : active
                              ? "APPROVED"
                              : latest?.status || "DRAFT"
                        }
                      />
                    </td>
                    <td>
                      <div className="avatar-stack">
                        {a.value.members.slice(0, 3).map((m) => (
                          <PersonAvatar key={m.userId} name={m.displayName} />
                        ))}
                        {a.value.members.length > 3 && (
                          <span
                            className="person-avatar"
                            aria-label={`${a.value.members.length - 3} more people`}
                          >
                            +{a.value.members.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span
                        className="split-summary"
                        title={shares
                          ?.map(
                            (share) =>
                              `${a.value.members.find((m) => m.userId === share.userId)?.displayName || "Participant"}: ${share.basisPoints / 100}%`,
                          )
                          .join(", ")}
                      >
                        {shares?.length
                          ? shares
                              .map((share) => `${share.basisPoints / 100}%`)
                              .join(" / ")
                          : "Not set"}
                      </span>
                    </td>
                    <td className="numeric">
                      {money(
                        a.value.revenue.reduce(
                          (sum, revenue) => sum + revenue.netCents,
                          0,
                        ),
                      )}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        aria-label={`Open ${a.value.name}`}
                        onClick={() => onOpen(a)}
                      >
                        →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No matching agreements">
          Try another name or status filter.
        </Empty>
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
          <th>Received</th>
          <th className="numeric">Net amount</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {agreement.value.revenue.map((r) => (
          <tr key={r.providerCaptureId}>
            <td>{new Date(r.at).toLocaleDateString()}</td>
            <td className="numeric">{money(r.netCents)}</td>
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
    <Empty title="No confirmed revenue">
      Incoming payments will appear once the provider has confirmed the payment
      and its fees.
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
          <th className="numeric">Recoupment</th>
          <th className="numeric">Share</th>
          <th className="numeric">Fee</th>
          <th className="numeric">Total allocated</th>
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
      <Field label="Gross payment (USD)">
        <input name="gross" defaultValue="3000" inputMode="decimal" required />
      </Field>
      <Field label="Provider fee (USD)">
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
        Suggestions are not active rules. Confirm every interpretation against
        the original text.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        I authorize processing this agreement with Cloudflare for extraction.
      </label>
      <Button
        variant="secondary"
        disabled={busy || !consent}
        onClick={onExtract}
      >
        Suggest terms
      </Button>
      {extraction && (
        <div className="panel">
          <Badge value={extraction.status || "REVIEW_REQUIRED"} />
          <h4>Suggested terms</h4>
          {extraction.reason && (
            <Notice warning>
              {title(extraction.reason)}. Continue with manual review; no
              AI-derived rules were activated.
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
            Enter the reviewed terms below. AI never activates or approves a
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
}: {
  agreement: Agreement;
  source: string;
  documentId: string;
  busy: boolean;
  extraction?: unknown;
  onSave: (r: Rules) => void;
  onDirty?: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
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
    <form
      ref={formRef}
      inert={busy}
      onChange={onDirty}
      className="section rules-editor"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const f = new FormData(e.currentTarget);
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
          if (advance)
            rules.advance = {
              id: old?.advance?.id || crypto.randomUUID(),
              recipientId: String(f.get("recipient")),
              amountCents: parseCents(String(f.get("advance"))),
              verified: f.get("verified") === "on",
              source: ref,
            };
          onSave(rules);
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <h3>Proposed rules</h3>
      <p className="muted">
        All participants review this version. Add people first; membership is
        locked once a proposal exists.
      </p>
      {Object.keys(suggestions).length > 0 && (
        <Notice>
          <p>
            AI found source-backed shares for {Object.keys(suggestions).length}{" "}
            people. Copy them into this draft, then check every value and
            complete any missing terms.
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
            }}
          >
            Use suggested shares
          </Button>
          {prefilled && (
            <p role="status">
              Shares copied into the draft. Nothing has been saved or approved.
              Review them before saving.
            </p>
          )}
        </Notice>
      )}
      {error && <Notice warning>{error}</Notice>}
      <div className="form-grid">
        {agreement.value.members.map((m) => (
          <Field key={m.userId} label={`${m.displayName} · share %`}>
            <input
              name={m.userId}
              required
              inputMode="decimal"
              defaultValue={
                old?.shares.find((s) => s.userId === m.userId)?.basisPoints !==
                undefined
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
              <select name="recipient" defaultValue={old?.advance?.recipientId}>
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
      <ClarificationDecisions extraction={extraction} documentId={documentId} />
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
      <Button disabled={busy}>Save proposal</Button>
    </form>
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

export function payoutStatus(status: string): PaymentGridStatus {
  if (status === "SUCCESS") return PaymentGridStatus.Paid;
  if (status === "UNCLAIMED") return PaymentGridStatus.Unclaimed;
  if (["FAILED", "DENIED", "BLOCKED"].includes(status))
    return PaymentGridStatus.Failed;
  if (["HELD", "ONHOLD"].includes(status)) return PaymentGridStatus.Held;
  if (["REFUNDED", "REVERSED", "RETURNED"].includes(status))
    return PaymentGridStatus.Reversed;
  if (["SUBMITTING", "PROCESSING"].includes(status))
    return PaymentGridStatus.Processing;
  if (["PENDING", "RESERVED"].includes(status))
    return PaymentGridStatus.Pending;
  return PaymentGridStatus.Unknown;
}
