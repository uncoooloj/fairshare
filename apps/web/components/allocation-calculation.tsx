import { statusLabel } from "../lib/status-labels";
import type { AllocationTrace } from "../lib/allocation-trace";
import { formatDay, formatExact } from "../lib/dates";
import { money, title } from "../lib/model";

/** Recorded history only: every figure comes from the trace, nothing is recomputed. */
export function AllocationCalculation({
  trace,
  name = "This person",
  tone,
  advanceTo,
}: {
  trace: AllocationTrace;
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
  const showAdvanceClause = Boolean(
    trace.advanceSource && (trace.recoupedCents > 0 || trace.poolCents === 0),
  );
  const showSplitClause = a.shareCents > 0 || !showAdvanceClause;
  let step = 1;
  return (
    <section className="calculation" aria-label={`Calculation for ${name}`}>
      <p className="calculation-headline">
        <strong>{money(a.totalCents)}</strong> to {name}
      </p>
      <p className="calculation-reason">{reason}</p>
      <div className="calculation-chips">
        <span
          className={`status-chip ${trace.held ? "warning" : ""}`}
          title="This is what they’re owed. Sending it is tracked in Payouts."
        >
          {trace.held ? "Paused" : statusLabel(a.status)}
        </span>
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
      </p>

      <h3 className="calculation-label">Rules used</h3>
      <p>
        <span className="version-chip">v{trace.versionId}</span> The split in
        use when this payment came in
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
                  {trace.advanceSource.clause && (
                    <span className="clause-chip">
                      § {trace.advanceSource.clause}
                    </span>
                  )}
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
                  {trace.source.clause && (
                    <span className="clause-chip">§ {trace.source.clause}</span>
                  )}
                </span>
              </td>
              <td className="numeric">{money(a.shareCents)}</td>
            </tr>
          ) : (
            <tr className="calculation-skipped">
              <td />
              <td colSpan={2}>No split from this payment</td>
            </tr>
          )}
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

      <h3 className="calculation-label">
        {showAdvanceClause && showSplitClause
          ? "Source clauses"
          : "Source clause"}
      </h3>
      {showAdvanceClause && trace.advanceSource && (
        <figure className="clause-card">
          <span className="clause-chip">§ {trace.advanceSource.clause}</span>
          <blockquote>{trace.advanceSource.excerpt}</blockquote>
        </figure>
      )}
      {showSplitClause && (
        <figure className="clause-card">
          <span className="clause-chip">§ {trace.source.clause || "—"}</span>
          <blockquote>
            {trace.source.excerpt || "Source excerpt not recorded."}
          </blockquote>
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
