import type { AllocationTrace } from "../lib/allocation-trace";
import { money, title } from "../lib/model";

export function AllocationCalculation({ trace }: { trace: AllocationTrace }) {
  const a = trace.allocation;
  return (
    <section aria-label="Recorded allocation calculation">
      <h3>From payment to share</h3>
      <dl>
        <dt>Source payment</dt>
        <dd>
          {money(trace.grossCents)} · PayPal <code>{trace.captureId}</code>
        </dd>
        <dt>Payment recorded</dt>
        <dd>
          {Number.isFinite(Date.parse(trace.recordedAt))
            ? new Date(trace.recordedAt).toLocaleString()
            : "Not recorded"}
        </dd>
        <dt>Rules used</dt>
        <dd>Version {trace.versionId} · historical rules for this payment</dd>
        <dt>Provider fee / net received</dt>
        <dd>
          {money(trace.providerFeeCents)} / {money(trace.netCents)}
        </dd>
        <dt>Advance recouped across all people</dt>
        <dd>{money(trace.recoupedCents)}</dd>
        <dt>Remaining split pool</dt>
        <dd>{money(trace.poolCents)}</dd>
        <dt>This person's share</dt>
        <dd>
          {trace.shareBasisPoints / 100}% of {money(trace.poolCents)} →{" "}
          {money(a.shareCents)}
        </dd>
        <dt>Rounding</dt>
        <dd>
          {trace.roundingCents === 0
            ? "No extra cent assigned."
            : `${trace.roundingCents} cent assigned above the whole-cent share.`}{" "}
          Fractional cents use largest remainder, with participant ID as the
          tie-break.
        </dd>
        <dt>Recorded allocation</dt>
        <dd>
          {money(a.recoupmentCents)} recoupment + {money(a.shareCents)} share −{" "}
          {money(a.feeCents)} recipient fee ={" "}
          <strong>{money(a.totalCents)}</strong>
        </dd>
        <dt>Allocation status</dt>
        <dd>
          {trace.held ? "On hold for review" : title(a.status)}. This is
          separate from payout completion.
        </dd>
      </dl>
      <h4>Source clause · {trace.source.clause || "Not recorded"}</h4>
      <blockquote>
        {trace.source.excerpt || "Source excerpt not recorded."}
      </blockquote>
      <p className="muted">
        Document: {trace.source.documentId || "Not recorded"} ·{" "}
        {title(trace.source.origin)}
      </p>
      {trace.advanceSource && (
        <>
          <h4>Advance clause · {trace.advanceSource.clause}</h4>
          <blockquote>{trace.advanceSource.excerpt}</blockquote>
        </>
      )}
    </section>
  );
}
