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
  const reason = trace.poolCents
    ? `${percent}% of the ${money(trace.poolCents)} left${
        trace.recoupedCents
          ? ` after ${money(trace.recoupedCents)} went to the advance`
          : ""
      }.`
    : trace.recoupedCents > 0
      ? `This payment went entirely to the advance.`
      : `No money remained to split after processing fees.`;
  const base = trace.netCents || 1;
  const ownsAdvance = a.recoupmentCents > 0;
  const toneClass = `tone-${tone ?? 0}`;
  const advanceHolder = ownsAdvance ? name : advanceTo;
  const showAdvanceClause = Boolean(
    trace.advanceSource && (ownsAdvance || trace.poolCents === 0),
  );
  const showSplitClause = a.shareCents > 0 || !showAdvanceClause;
  const showTrailingAdvanceClause = Boolean(
    trace.advanceSource && !showAdvanceClause && trace.recoupedCents > 0,
  );
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
          title="An allocation records what is owed. The payout is tracked separately."
        >
          {trace.held ? "On hold for review" : title(a.status)}
        </span>
      </div>

      <div
        className="waterfall"
        role="img"
        aria-label={`${money(trace.netCents)} received: ${money(trace.recoupedCents)} to the advance, ${money(trace.poolCents)} split, ${money(a.shareCents)} to ${name}.`}
      >
        {trace.recoupedCents > 0 && (
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
        {trace.recoupedCents > 0 && (
          <span
            className={`key-advance ${ownsAdvance ? `is-own ${toneClass}` : ""}`}
          >
            {advanceHolder ? `Advance → ${advanceHolder}` : "Advance"}
          </span>
        )}
        {trace.poolCents > 0 && <span className="key-pool">Split pool</span>}
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
        <span className="version-chip">v{trace.versionId}</span> The rules in
        force when this payment arrived
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
                  Recoup advance
                  {trace.advanceSource.clause && (
                    <span className="clause-chip">
                      § {trace.advanceSource.clause}
                    </span>
                  )}
                </span>
                <small>
                  {a.recoupmentCents > 0
                    ? `${name} is paid back first`
                    : `Paid back to ${advanceTo || "the advance holder"} first`}
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
            <td>Allocated to {name}</td>
            <td className="numeric">{money(a.totalCents)}</td>
          </tr>
        </tbody>
      </table>

      <h3 className="calculation-label">
        {(showAdvanceClause && showSplitClause) || showTrailingAdvanceClause
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
      {showTrailingAdvanceClause && trace.advanceSource && (
        <figure className="clause-card">
          <span className="clause-chip">§ {trace.advanceSource.clause}</span>
          <blockquote>{trace.advanceSource.excerpt}</blockquote>
        </figure>
      )}

      <details className="disclosure">
        <summary>Show working</summary>
        <dl className="facts-list">
          <dt>PayPal capture</dt>
          <dd>
            <code>{trace.captureId}</code>
          </dd>
          <dt>Provider fee / net received</dt>
          <dd>
            {money(trace.providerFeeCents)} / {money(trace.netCents)}
          </dd>
          <dt>Rounding</dt>
          <dd>
            {trace.roundingCents === 0
              ? "No extra cent assigned."
              : `${trace.roundingCents} cent assigned above the whole-cent share.`}{" "}
            Fractional cents use largest remainder, with participant ID as the
            tie-break.
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
