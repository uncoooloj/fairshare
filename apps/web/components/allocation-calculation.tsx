import { statusLabel } from "../lib/status-labels";
import type { AllocationTrace } from "../lib/allocation-trace";
import { formatDay, formatExact } from "../lib/dates";
import { money, title, type Source } from "../lib/model";
import {
  PaymentGridStatus,
  paymentStatusLabels,
} from "../src/components/paymentGridModel";

/** Payout state in the words the Payouts page uses; "On the way" covers queued and sending. */
function payoutLabel(status: PaymentGridStatus) {
  if (
    status === PaymentGridStatus.Pending ||
    status === PaymentGridStatus.Processing
  )
    return "On the way";
  return paymentStatusLabels[status];
}

/** A clause number when the rule came from the document; otherwise the team typed it. */
function SourceChip({ source }: { source?: Source }) {
  if (!source) return null;
  if (source.origin !== "SOURCE_CLAUSE")
    return <span className="clause-chip is-team">Added by you</span>;
  const clause = source.clause.replace(/^(clause|section|§)\s*/i, "").trim();
  return clause ? <span className="clause-chip">§ {clause}</span> : null;
}

/** Only a real document clause is worth quoting back. */
const fromDocument = (source?: Source): source is Source =>
  source?.origin === "SOURCE_CLAUSE" && !!source.excerpt?.trim();

/** Recorded history only: every figure comes from the trace, nothing is recomputed. */
export function AllocationCalculation({
  trace,
  name = "This person",
  tone,
  advanceTo,
  payout,
}: {
  trace: AllocationTrace;
  /** The payout for this share, from the same records the Payouts page reads. */
  payout?: PaymentGridStatus;
  name?: string;
  tone?: number;
  advanceTo?: string;
}) {
  const a = trace.allocation;
  const percent = trace.shareBasisPoints / 100;
  const reasonParts = [
    trace.advanceSource && a.recoupmentCents > 0
      ? `${money(a.recoupmentCents)} went to paying back the advance.`
      : undefined,
    trace.poolCents > 0
      ? `${money(a.shareCents)} is this person's ${percent}% share of the ${money(trace.poolCents)} left to split.`
      : undefined,
    a.feeCents > 0
      ? `${money(a.feeCents)} PayPal fee came out of that share.`
      : undefined,
  ].filter(Boolean);
  const reason = reasonParts.length
    ? reasonParts.join(" ")
    : trace.netCents === 0
      ? "No money remained to split after processing fees."
      : "No amount was allocated to this person from the recorded rules.";
  const waterfallDescription = [
    `${money(trace.netCents)} after PayPal’s fee`,
    trace.advanceSource && trace.recoupedCents > 0
      ? `${money(trace.recoupedCents)} to the advance`
      : undefined,
    trace.poolCents > 0 ? `${money(trace.poolCents)} split` : undefined,
    `${money(a.shareCents)} to ${name}`,
    a.feeCents > 0 ? `${money(a.feeCents)} recipient fee` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  const base = trace.netCents || 1;
  const ownsAdvance = a.recoupmentCents > 0;
  const toneClass = `tone-${tone ?? 0}`;
  const advanceHolder = ownsAdvance ? name : advanceTo;
  // Clauses follow the steps: the advance clause first whenever this payment repaid it.
  const showAdvanceClause =
    Boolean(trace.recoupedCents > 0 || trace.poolCents === 0) &&
    fromDocument(trace.advanceSource);
  const showSplitClause =
    (a.shareCents > 0 || !showAdvanceClause) && fromDocument(trace.source);
  let step = 1;
  return (
    <section className="calculation" aria-label={`Calculation for ${name}`}>
      <p className="calculation-headline">
        <strong>{money(a.totalCents)}</strong> to {name}
      </p>
      <p className="calculation-reason">{reason}</p>
      <div className="calculation-chips">
        {trace.held ? (
          <span className="status-chip warning">Paused</span>
        ) : payout ? (
          <span
            className={`status-chip ${payout === PaymentGridStatus.Paid ? "good" : ""}`}
          >
            {payoutLabel(payout)}
          </span>
        ) : (
          <span
            className="status-chip"
            title="This is what they’re owed. Sending it is tracked in Payouts."
          >
            {statusLabel(a.status)}
          </span>
        )}
      </div>

      <div className="waterfall" role="img" aria-label={waterfallDescription}>
        {trace.advanceSource && trace.recoupedCents > 0 && (
          <span
            className={`waterfall-advance ${ownsAdvance ? `is-own ${toneClass}` : ""}`}
            style={{ flexGrow: trace.recoupedCents / base }}
          />
        )}
        {trace.poolCents > 0 && (
          <span
            className="waterfall-pool"
            style={{ flexGrow: trace.poolCents / base }}
          >
            <span
              className={`waterfall-share tone-${tone ?? 0}`}
              style={{ width: `${percent}%` }}
            />
          </span>
        )}
      </div>
      <div className="waterfall-legend" aria-hidden="true">
        {trace.advanceSource && trace.recoupedCents > 0 && (
          <span
            className={`key-advance ${ownsAdvance ? `is-own ${toneClass}` : ""}`}
          >
            {advanceHolder ? `Advance → ${advanceHolder}` : "Advance"}
          </span>
        )}
        {trace.poolCents > 0 && <span className="key-pool">Left to split</span>}
        {a.shareCents > 0 && (
          <span className={`key-share ${toneClass}`}>{name}&rsquo;s share</span>
        )}
      </div>

      <h3 className="calculation-label">From payment</h3>
      <p title={formatExact(trace.recordedAt)}>
        {money(trace.grossCents)} · PayPal · {formatDay(trace.recordedAt)}
        <span className="muted">
          {" "}
          ·{" "}
          {trace.providerFeeCents
            ? `${money(trace.providerFeeCents)} PayPal fee`
            : "No fee"}
        </span>
      </p>

      <h3 className="calculation-label">Rules used</h3>
      <p title={`Version ${trace.versionId}`}>
        Split in use on {formatDay(trace.recordedAt)}
      </p>

      <h3 className="calculation-label">Calculation</h3>
      <table className="calculation-steps">
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Description</th>
            <th scope="col" className="numeric">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {trace.advanceSource && (
            <tr>
              <td>{step++}</td>
              <td>
                <span className="calculation-step-title">
                  Pay back advance
                  <SourceChip source={trace.advanceSource} />
                </span>
                <small>
                  {`Paid back to ${advanceHolder || "the advance holder"} first`}
                </small>
              </td>
              <td className="numeric">
                {a.recoupmentCents > 0 ? (
                  money(a.recoupmentCents)
                ) : (
                  <span className="muted">
                    {money(trace.recoupedCents)} to {advanceTo || "advance"}
                  </span>
                )}
              </td>
            </tr>
          )}
          {trace.poolCents > 0 ? (
            <tr>
              <td>{step++}</td>
              <td>
                <span className="calculation-step-title">
                  Split {percent}% of {money(trace.poolCents)}
                  <SourceChip source={trace.source} />
                </span>
              </td>
              <td className="numeric">{money(a.shareCents)}</td>
            </tr>
          ) : trace.netCents > 0 ? (
            <tr className="calculation-skipped">
              <td />
              <td colSpan={2}>Nothing left to split after the advance</td>
            </tr>
          ) : null}
          {a.feeCents > 0 && (
            <tr>
              <td>{step++}</td>
              <td>Recipient fee</td>
              <td className="numeric">−{money(a.feeCents)}</td>
            </tr>
          )}
          <tr className="calculation-total">
            <td />
            <td>Owed to {name}</td>
            <td className="numeric">{money(a.totalCents)}</td>
          </tr>
        </tbody>
      </table>

      {(showAdvanceClause || showSplitClause) && (
        <h3 className="calculation-label">
          {showAdvanceClause && showSplitClause
            ? "Source clauses"
            : "Source clause"}
        </h3>
      )}
      {showAdvanceClause && trace.advanceSource && (
        <figure className="clause-card">
          <SourceChip source={trace.advanceSource} />
          <blockquote>{trace.advanceSource.excerpt}</blockquote>
        </figure>
      )}
      {showSplitClause && (
        <figure className="clause-card">
          <SourceChip source={trace.source} />
          <blockquote>{trace.source.excerpt}</blockquote>
        </figure>
      )}

      <details className="disclosure">
        <summary>Show working</summary>
        <dl className="facts-list">
          <dt>PayPal payment ID</dt>
          <dd>
            <code>{trace.captureId}</code>
          </dd>
          <dt>PayPal fee / left to split</dt>
          <dd>
            {money(trace.providerFeeCents)} / {money(trace.netCents)}
          </dd>
          <dt>Rounding</dt>
          <dd>
            {trace.roundingCents === 0
              ? "No extra cent assigned."
              : `${trace.roundingCents} cent assigned above the whole-cent share.`}{" "}
            Leftover cents go to whoever had the biggest fraction.
          </dd>
          <dt>Source document</dt>
          <dd>
            <code>{trace.source.documentId || "Not recorded"}</code> ·{" "}
            {title(trace.source.origin)}
          </dd>
        </dl>
      </details>
    </section>
  );
}
