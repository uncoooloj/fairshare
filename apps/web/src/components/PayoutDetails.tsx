"use client";
import { AllocationCalculation } from "../../components/allocation-calculation";
import { CloseButton } from "../../components/close-button";
import { formatExact } from "../../lib/dates";
import { useEffect, useId, useRef } from "react";
import {
  formatPaymentAmount,
  paymentStatusLabel,
  type PaymentGridRow,
} from "./paymentGridModel";
import {
  payoutDate,
  payoutGuidance,
  payoutSentLabel,
} from "./payoutPresentation";
import styles from "./payouts.module.css";
/** Read-only detail: no mutation, payout retry, or inferred calculation. */
export function PayoutDetails({
  row,
  onClose,
  onOpenAgreement,
}: {
  row: PaymentGridRow;
  onClose: () => void;
  onOpenAgreement?: (agreementKey: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const title = useId();
  const created = payoutDate(row.createdAt);
  const sent = payoutSentLabel(row);
  useEffect(() => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      element?.close();
      opener.current?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.drawer}
      aria-labelledby={title}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <header className={styles.drawerHeader}>
        <h2 id={title}>Payout details</h2>
        <CloseButton onClick={onClose} autoFocus label="Close payout details" />
      </header>
      <p className={styles.label}>{row.recipientName}</p>
      <strong className={styles.amount}>
        {formatPaymentAmount(row.amountCents, row.currency)}
      </strong>
      <p>
        <span className={styles.status} data-status={row.status}>
          {paymentStatusLabel(row)}
        </span>
        {sent && (
          <>
            {" "}
            <span title={formatExact(row.updatedAt)}>{sent}</span>
          </>
        )}
      </p>
      <p className={styles.guidance}>{payoutGuidance[row.status]}</p>
      <dl className={styles.facts}>
        <div>
          <dt>Agreement</dt>
          <dd>{row.agreementName}</dd>
        </div>
        <div>
          <dt>Payout ID</dt>
          <dd>
            <code>{row.payoutId}</code>
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <span title={created.title}>{created.label}</span>
          </dd>
        </div>
        <div>
          <dt>PayPal reference</dt>
          <dd>
            <code>{row.providerReference || "Not recorded"}</code>
          </dd>
        </div>
      </dl>
      <section className={styles.drawerNote}>
        <h3>How was this share calculated?</h3>
        {row.trace ? (
          <AllocationCalculation
            trace={row.trace}
            name={row.recipientName}
            compact
          />
        ) : (
          <p>
            We can’t show the maths for this one. Open the agreement to check.
          </p>
        )}
        {onOpenAgreement && (
          <button
            className={styles.control}
            type="button"
            onClick={() => {
              onClose();
              onOpenAgreement(row.agreementKey);
            }}
          >
            Open agreement
          </button>
        )}
      </section>
    </dialog>
  );
}
