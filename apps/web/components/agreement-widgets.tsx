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
    <div>
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
export function Auth({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string;
  onSubmit: (type: string, data: Record<string, string>) => void;
}) {
  const [login, setLogin] = useState(true);
  return (
    <main className="auth">
      <Logo />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = Object.fromEntries(
            new FormData(e.currentTarget),
          ) as Record<string, string>;
          onSubmit(login ? "login" : "register", data);
        }}
      >
        <span className="eyebrow">THE MONEY FOLLOWS THE AGREEMENT</span>
        <h1>{login ? "Welcome back" : "Create your account"}</h1>
        <p>Clear agreements. Shared understanding. Traceable payouts.</p>
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        {!login && (
          <Field label="Full name">
            <input name="name" autoComplete="name" required maxLength={80} />
          </Field>
        )}
        <Field label="Email">
          <input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <input
            name="password"
            type="password"
            autoComplete={login ? "current-password" : "new-password"}
            required
            minLength={login ? 1 : 12}
          />
        </Field>
        {!login && (
          <small>
            Use at least 12 characters. Use a synthetic account for sandbox
            testing.
          </small>
        )}
        <Button disabled={busy}>
          {busy ? "Please wait…" : login ? "Sign in" : "Create account"}
        </Button>
        <button
          type="button"
          className="text-button"
          onClick={() => setLogin(!login)}
        >
          {login
            ? "New to Fairshare? Create an account"
            : "Already have an account? Sign in"}
        </button>
        <p className="fineprint">
          Sandbox build. No live money. Password recovery is not available in
          this build.
        </p>
      </form>
    </main>
  );
}
export function AgreementList({
  agreements,
  onOpen,
}: {
  agreements: Agreement[];
  onOpen: (a: Agreement) => void;
}) {
  return agreements.length ? (
    <table>
      <thead>
        <tr>
          <th>Agreement</th>
          <th>People</th>
          <th>Net revenue received</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {agreements.map((a) => (
          <tr key={a.id}>
            <td>
              <button className="text-button strong" onClick={() => onOpen(a)}>
                {a.value.name}
              </button>
            </td>
            <td>
              {a.value.members.length}{" "}
              {a.value.members.length === 1 ? "person" : "people"}
            </td>
            <td>
              {money(a.value.revenue.reduce((s, r) => s + r.netCents, 0))}
            </td>
            <td>
              <Badge
                value={
                  a.value.reviewHold
                    ? "REVIEW_REQUIRED"
                    : a.value.activeVersionId
                      ? "ACTIVE"
                      : a.value.versions.at(-1)?.status || "DRAFT"
                }
              />
            </td>
            <td>
              <button
                className="text-button"
                aria-label={`Open ${a.value.name}`}
                onClick={() => onOpen(a)}
              >
                ↗
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <Empty title="Your first agreement starts here">
      Create an agreement, bring in your collaborators and make the split clear
      before money comes in.
    </Empty>
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
      <tbody>
        {rules.shares.map((s) => (
          <tr key={s.userId}>
            <td>
              {
                agreement.value.members.find((m) => m.userId === s.userId)
                  ?.displayName
              }
            </td>
            <td className="numeric strong">{s.basisPoints / 100}%</td>
          </tr>
        ))}
      </tbody>
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
          <th>Net amount</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {agreement.value.revenue.map((r) => (
          <tr key={r.providerCaptureId}>
            <td>{new Date(r.at).toLocaleDateString()}</td>
            <td>{money(r.netCents)}</td>
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
  allocations: any[];
  agreement: Agreement;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Person</th>
          <th>Recoupment</th>
          <th>Share</th>
          <th>Fee</th>
          <th>Total allocated</th>
        </tr>
      </thead>
      <tbody>
        {allocations.map((a) => (
          <tr key={a.userId}>
            <td>
              {
                agreement.value.members.find((m) => m.userId === a.userId)
                  ?.displayName
              }
            </td>
            <td>{money(a.recoupmentCents)}</td>
            <td>{money(a.shareCents)}</td>
            <td>{money(a.feeCents)}</td>
            <td className="strong">{money(a.totalCents)}</td>
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
      <h3>Read the agreement with AI</h3>
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
          <h4>Source-bound observations</h4>
          {extraction.reason && (
            <Notice warning>
              {title(extraction.reason)}. Continue with manual review; no
              AI-derived rules were activated.
            </Notice>
          )}
          {extraction.facts?.map((fact: any, i: number) => (
            <div className="observation" key={i}>
              <strong>
                {fact.subject} · {title(fact.kind)}
              </strong>
              <p>{fact.rawValue}</p>
              <blockquote>{fact.citation?.quote}</blockquote>
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
}: {
  agreement: Agreement;
  source: string;
  documentId: string;
  busy: boolean;
  extraction?: unknown;
  onSave: (r: Rules) => void;
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
      className="section"
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
            unresolvedQuestions: String(f.get("questions"))
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
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
      <h3>Propose the rules</h3>
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
