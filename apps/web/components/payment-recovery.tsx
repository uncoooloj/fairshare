"use client";
import { useEffect, useRef, useState } from "react";
import { api, money } from "../lib/model";
import {
  recoveryRequest,
  refundBlocked,
  refundMessage,
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
    [confirmed, setConfirmed] = useState(false);
  const flight = useRef(createSingleFlight());
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
          e instanceof Error ? e.message : "Unable to verify provider status.";
      } finally {
        try {
          await load();
          await refresh();
        } catch {
          // Never offer a refund from stale evidence after a failed refresh.
          setData(null);
          setNotice("");
          actionError = `${actionError ? `${actionError} ` : ""}Unable to refresh. Refresh recovery information before taking another action. Do not resubmit an uncertain transfer.`;
        }
        setError(actionError);
        setBusy(false);
      }
    });
  }
  const payment = payments.find((p) => p.id === chosen);
  return (
    <section
      className={styles.root}
      aria-label="Recovery and refunds"
      aria-busy={busy}
    >
      <div className={styles.header}>
        <div>
          <h3>Recovery & refunds</h3>
          <p>
            Resolve uncertain payment statuses using existing PayPal evidence.
            Checking a reference never sends another payment or clears an
            agreement hold.
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
            ? "Recovery information is unavailable. Refresh before taking any action."
            : "Loading recovery information…"}
        </p>
      ) : (
        <>
          <details>
            <summary>Review payment recovery</summary>
            {!data.payments.length && !data.payouts.length && (
              <p>No uncertain payment or payout operations recorded.</p>
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
                  setNotice(
                    "Provider evidence checked. Review the updated payment status; no new payment was sent.",
                  )
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
                    "Provider evidence checked. Submission or pending status is not completion.",
                  )
                }
              />
            ))}
          </details>
          <details>
            <summary>Refund an original payment</summary>
            <p>
              Full amount to the original sandbox payer only. Available before
              any payout reservation. This pauses the agreement and retains
              liabilities for review.
            </p>
            <Field label="Payment">
              <select
                value={chosen}
                onChange={(e) => {
                  setChosen(e.target.value);
                  setConfirmed(false);
                }}
                disabled={busy}
              >
                <option value="">Choose a payment</option>
                {payments.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id.slice(0, 8)} · {money(p.amount)} · {p.status}
                  </option>
                ))}
              </select>
            </Field>
            {payment &&
              (refundBlocked(payment, payouts, data.refunds, held) ? (
                <Notice warning>
                  {refundBlocked(payment, payouts, data.refunds, held)}
                </Notice>
              ) : (
                <>
                  <Field
                    label={`Confirm full ${money(payment.amount)} USD refund to the original sandbox payer`}
                  >
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      disabled={busy}
                    />
                  </Field>
                  <Button
                    disabled={busy || !confirmed}
                    onClick={() =>
                      run(async () => {
                        setConfirmed(false);
                        const result = await api(
                          `${base}/payments/${payment.id}/refund`,
                          "POST",
                          { confirmFullRefund: true },
                        );
                        setNotice(refundMessage(result.status));
                      })
                    }
                  >
                    Submit full sandbox refund
                  </Button>
                </>
              ))}
          </details>
          {busy && (
            <p role="status">
              Checking payment information… Do not submit another transfer.
            </p>
          )}
          <h4>Refund status</h4>
          {!data.refunds.length && <p>No refunds recorded.</p>}
          {data.refunds.map((r: any) => (
            <div className={styles.evidence} key={r.id}>
              <p>
                {money(r.amount)} · <code>{r.id}</code>{" "}
                <Badge value={r.status} />
              </p>
              <p>{refundMessage(r.status)}</p>
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
                      setNotice(refundMessage(result.status));
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
      ? "Order ID with completed capture"
      : kind === "payout"
        ? "Payout batch ID"
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
        hint="Use the exact reference from the sandbox provider record. Unmatched evidence will be rejected."
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
        Verify existing provider evidence
      </Button>
    </form>
  );
}
