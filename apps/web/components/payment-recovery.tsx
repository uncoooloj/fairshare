"use client";
import { statusLabel } from "../lib/status-labels";
import React, { useEffect, useRef, useState } from "react";
import { api, money } from "../lib/model";
import {
  recoveryRequest,
  refundBlocked,
  refundablePayments,
  refundableCents,
  refundMessage,
  parseRefundAmount,
  createSingleFlight,
} from "../lib/payment-recovery";
import styles from "./payment-recovery.module.css";
import { Badge, Button, Field, Notice } from "./ui";
export function PaymentRecovery({
  base,
  payments,
  payouts,
  held,
  refresh,
}: {
  base: string;
  payments: any[];
  payouts: any[];
  held: boolean;
  refresh: () => Promise<void>;
}) {
  const [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [chosen, setChosen] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [amount, setAmount] = useState("");
  const flight = useRef(createSingleFlight());
  // One key per refund the organizer means to make, so a retried click never refunds twice.
  const refundKey = useRef(crypto.randomUUID());
  const newRefundKey = () => {
    refundKey.current = crypto.randomUUID();
  };
  async function load() {
    const result = await api(`${base}/recovery`);
    setData(result);
  }
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setNotice("");
    setConfirmed(false);
    api(`${base}/recovery`)
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, payments]);
  async function run(action: () => Promise<void>) {
    // A synchronous lock also catches rapid clicks before React renders disabled controls.
    await flight.current(async () => {
      setBusy(true);
      setConfirmed(false);
      setError("");
      setNotice("");
      let actionError = "";
      try {
        await action();
      } catch (e) {
        actionError =
          e instanceof Error
            ? e.message
            : "We couldn’t check the payment status. Please refresh before continuing.";
      } finally {
        try {
          await load();
          await refresh();
        } catch {
          // Never offer a refund from stale evidence after a failed refresh.
          setData(null);
          setNotice("");
          actionError = `${actionError ? `${actionError} ` : ""}Couldn’t refresh. Refresh before you do anything else.`;
        }
        setError(actionError);
        setBusy(false);
      }
    });
  }
  const refundOptions = refundablePayments(payments);
  const payment = refundOptions.find((p) => p.id === chosen);
  const left = payment && data ? refundableCents(payment, data.refunds) : 0;
  let amountCents = 0,
    amountError = "";
  try {
    if (payment && amount.trim()) amountCents = parseRefundAmount(amount, left);
  } catch (e) {
    amountError = e instanceof Error ? e.message : "Check the amount.";
  }
  return (
    <section
      className={styles.root}
      aria-label="Recovery and refunds"
      aria-busy={busy}
    >
      <div className={styles.header}>
        <div>
          <h3>Payment problems</h3>
          <p>
            If a payment looks stuck, check it against PayPal. A confirmed
            payment can be split and follow your payout settings.
          </p>
        </div>
        <span className={styles.sandbox}>Sandbox only</span>
      </div>
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
        </div>
      )}
      {notice && (
        <div role="status">
          <Notice>{notice}</Notice>
        </div>
      )}
      {!data ? (
        <p role="status">
          {error
            ? "We couldn’t load the latest payment details. Refresh before continuing."
            : "Loading recovery information…"}
        </p>
      ) : (
        <>
          {data.providerHold && (
            <Notice warning>
              A verified provider event is awaiting reconciliation. A recheck
              never clears an existing payment hold.
            </Notice>
          )}
          {!!data.events?.length && (
            <section aria-label="Provider event recovery">
              <h4>Provider events needing review</h4>
              {data.events.map((event: any) => (
                <div key={event.id} className="actions">
                  <span>
                    {event.eventType} · {event.error || event.status}
                  </span>
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const result = await api(
                          `${base}/recovery/events/${encodeURIComponent(event.id)}/reconcile`,
                          "POST",
                          {},
                        );
                        setNotice(
                          result.status === "DONE"
                            ? "Provider event reconciled. Existing payment holds remain in place."
                            : "The event still needs matching provider evidence. No payment was resent.",
                        );
                      })
                    }
                  >
                    Recheck provider event
                  </Button>
                </div>
              ))}
            </section>
          )}
          {data.providerHold && !data.events?.length && (
            <p>
              An event cannot yet be matched safely to this agreement. Operator
              review is required; do not retry a payment or clear the hold.
            </p>
          )}
          <details>
            <summary>Check a stuck payment</summary>
            {!data.payments.length && !data.payouts.length && (
              <p>Nothing stuck.</p>
            )}
            {data.payments.map((p: any) => (
              <Evidence
                key={p.id}
                kind="payment"
                op={p}
                base={base}
                busy={busy}
                run={run}
                onResult={() =>
                  setNotice("Checked with PayPal. Status updated.")
                }
              />
            ))}
            {data.payouts.map((p: any) => (
              <Evidence
                key={p.id}
                kind="payout"
                op={p}
                base={base}
                busy={busy}
                run={run}
                onResult={() =>
                  setNotice(
                    "Checked with PayPal. Pending doesn’t mean paid yet.",
                  )
                }
              />
            ))}
          </details>
          <details>
            <summary>Refund a payment</summary>
            <p>
              Sends money back to whoever paid. You can refund all or part of a
              payment, before any of it is paid out. The refund comes back out
              of everyone’s split for that payment, the same way it was split.
            </p>
            <p>
              Invoice payments are refunded in PayPal only. After refunding one
              there, use Check status on the invoice to update it here.
            </p>
            <Field label="Payment">
              <select
                value={chosen}
                onChange={(e) => {
                  setChosen(e.target.value);
                  setConfirmed(false);
                  newRefundKey();
                  const next = refundOptions.find(
                    (p) => p.id === e.target.value,
                  );
                  setAmount(
                    next && data
                      ? (refundableCents(next, data.refunds) / 100).toFixed(2)
                      : "",
                  );
                }}
                disabled={busy}
              >
                <option value="">Choose a payment</option>
                {refundOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id.slice(0, 8)} · {money(p.amount)} ·{" "}
                    {statusLabel(p.status)}
                  </option>
                ))}
              </select>
            </Field>
            {payment &&
              (refundBlocked(
                payment,
                payouts,
                data.refunds,
                held || !!data.providerHold,
              ) ? (
                <Notice warning>
                  {refundBlocked(
                    payment,
                    payouts,
                    data.refunds,
                    held || !!data.providerHold,
                  )}
                </Notice>
              ) : (
                <>
                  <Field
                    label="Amount to refund (USD)"
                    hint={
                      amountError ||
                      `Up to ${money(left)}. Leave it as is to refund everything that’s left.`
                    }
                  >
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      value={amount}
                      aria-invalid={!!amountError}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setConfirmed(false);
                        newRefundKey();
                      }}
                      disabled={busy}
                    />
                  </Field>
                  {amountCents > 0 && (
                    <Field
                      label={`Confirm the ${money(amountCents)} refund to whoever paid (sandbox)`}
                    >
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        disabled={busy}
                      />
                    </Field>
                  )}
                  <Button
                    disabled={busy || !confirmed || amountCents < 1}
                    onClick={() =>
                      run(async () => {
                        setConfirmed(false);
                        const result = await api(
                          `${base}/payments/${payment.id}/refund`,
                          "POST",
                          {
                            confirmRefund: true,
                            amountCents,
                            requestKey: refundKey.current,
                          },
                        );
                        newRefundKey();
                        setNotice(refundMessage(result.status, result.outcome));
                      })
                    }
                  >
                    {amountCents > 0 && amountCents === left
                      ? `Refund all ${money(amountCents)}`
                      : amountCents > 0
                        ? `Refund ${money(amountCents)}`
                        : "Refund"}
                  </Button>
                </>
              ))}
          </details>
          {busy && <p role="status">Checking… don’t send anything else yet.</p>}
          <h4>Refund status</h4>
          {!data.refunds.length && <p>No refunds recorded.</p>}
          {data.refunds.map((r: any) => (
            <div className={styles.evidence} key={r.id}>
              <p>
                {money(r.amount)} · <code>{r.id}</code>{" "}
                <Badge value={r.status} />
              </p>
              <p>
                {r.settled_by_hold
                  ? "Refunded in full before refunds came out of the split. Payouts from this payment stay stopped."
                  : r.applied_at
                    ? "Refunded. It came back out of the split for this payment."
                    : refundMessage(r.status)}
              </p>
              {r.provider_refund_id ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const result = await api(
                        `${base}/refunds/${r.id}/reconcile`,
                        "POST",
                        {},
                      );
                      setNotice(refundMessage(result.status, result.outcome));
                    })
                  }
                >
                  Check refund status
                </Button>
              ) : (
                <Evidence
                  kind="refund"
                  op={r}
                  base={base}
                  busy={busy}
                  run={run}
                  onResult={(r) => setNotice(refundMessage(r.status))}
                />
              )}
            </div>
          ))}
        </>
      )}
      <Button
        variant="quiet"
        disabled={busy}
        onClick={() => run(async () => {})}
      >
        Refresh recovery information
      </Button>
    </section>
  );
}
function Evidence({
  kind,
  op,
  base,
  busy,
  run,
  onResult,
}: {
  kind: "payment" | "payout" | "refund";
  op: any;
  base: string;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onResult: (r: any) => void;
}) {
  const [value, setValue] = useState(op.provider_order_id || op.batch_id || "");
  const label =
    kind === "payment"
      ? "Order ID"
      : kind === "payout"
        ? "Payout ID"
        : "Refund ID";
  return (
    <form
      className={styles.evidence}
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const request = recoveryRequest(kind, op.id, value);
          const result = await api(
            `${base}/${request.path}`,
            "POST",
            request.body,
          );
          onResult(result);
        });
      }}
    >
      <p>
        <code>{op.id}</code> · <Badge value={op.status} />
      </p>
      <Field
        label={`PayPal sandbox ${label}`}
        hint="Find this in PayPal on the matching payment."
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={108}
          required
          disabled={busy}
        />
      </Field>
      <Button
        type="submit"
        variant="secondary"
        disabled={busy || !value.trim()}
      >
        Check with PayPal
      </Button>
    </form>
  );
}
