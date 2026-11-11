/** One definition everywhere: "Received" is what came in before PayPal's fee.
 * The PayPal fee is its own line, and what is split is what remains after it. */
export const RECEIVED_DEFINITION =
  "Received is what came in before PayPal’s fee. The PayPal fee is shown on its own line.";

export interface ReceivedTotals {
  /** Before PayPal's fee (gross). */
  receivedCents: number;
  paypalFeeCents: number;
  /** What was left to split (net). */
  afterFeeCents: number;
}

export function receivedTotals(
  revenue: readonly {
    grossCents: number;
    feeCents: number;
    netCents: number;
  }[],
): ReceivedTotals {
  const totals = revenue.reduce(
    (t, r) => ({
      receivedCents: t.receivedCents + r.grossCents,
      paypalFeeCents: t.paypalFeeCents + r.feeCents,
      afterFeeCents: t.afterFeeCents + r.netCents,
    }),
    { receivedCents: 0, paypalFeeCents: 0, afterFeeCents: 0 },
  );
  if (!Object.values(totals).every(Number.isSafeInteger))
    throw new Error("Received total exceeds safe integer range");
  return totals;
}
