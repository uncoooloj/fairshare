import type { AllocationTrace } from "../lib/allocation-trace";
import { formatDay, formatExact } from "../lib/dates";
import { money, title } from "../lib/model";

/** Recorded history only: every figure comes from the trace, nothing is recomputed. */
export function AllocationCalculation({
  trace,
  name = "This person",
  tone,
  onOpenDocument,
}: {
  trace: AllocationTrace;
  name?: string;
  tone?: number;
  onOpenDocument?: () => void;
}) {
  const a = trace.allocation;
  const percent = trace.shareBasisPoints / 100;
  const reason = trace.poolCents
    ? `${percent}% of the ${money(trace.poolCents)} left${
        trace.recoupedCents
          ? ` after ${money(trace.recoupedCents)} went to the advance`
          : ""
      }.`
    : `This payment went entirely to the advance.`;
  const base = trace.netCents || 1;
  return (
    <section className="calculation" aria-label={`Calculation for ${name}`}>
      <p className="calculation-headline">
        <strong>{money(a.totalCents)}</strong> to {name}
      </p>
      <p className="calculation-reason">{reason}</p>
      <div className="calculation-chips">
        <span className={`status-chip ${trace.held ? "warning" : "info"}`}>
          {trace.held ? "On hold for review" : title(a.status)}
        </span>
        <span className="muted">Not the same as paid out</span>
      </div>

      <div
        className="waterfall"
        role="img"
        aria-label={`${money(trace.netCents)} received: ${money(trace.recoupedCents)} to the advance, ${money(trace.poolCents)} split, ${money(a.shareCents)} to ${name}.`}
      >
        {trace.recoupedCents > 0 && (
          <span
            className="waterfall-advance"
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
          <span className="key-advance">Advance</span>
        )}
        {trace.poolCents > 0 && <span className="key-pool">Split pool</span>}
        <span className={`key-share tone-${tone ?? 0}`}>{name}</span>
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
          <tr>
            <td>1</td>
            <td>
              Recoup advance
              {trace.advanceSource?.clause && (
                <small> · clause {trace.advanceSource.clause}</small>
              )}
              <small>
                {money(trace.recoupedCents)} across everyone from this payment
              </small>
            </td>
            <td className="numeric">
              {money(a.recoupmentCents)} to {name}
            </td>
          </tr>
          <tr>
            <td>2</td>
            <td>
              Split {percent}% of {money(trace.poolCents)}
              {trace.source.clause && (
                <small> · clause {trace.source.clause}</small>
              )}
            </td>
            <td className="numeric">{money(a.shareCents)}</td>
          </tr>
          {a.feeCents > 0 && (
            <tr>
              <td>3</td>
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

      <h3 className="calculation-label">Source clause</h3>
      <figure className="clause-card">
        <span className="clause-chip">§ {trace.source.clause || "—"}</span>
        <blockquote>
          {trace.source.excerpt || "Source excerpt not recorded."}
        </blockquote>
        {onOpenDocument && (
          <button
            type="button"
            className="text-button"
            onClick={onOpenDocument}
          >
            Open in document →
          </button>
        )}
      </figure>
      {trace.advanceSource && (
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
