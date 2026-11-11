"use client";
import React, { useEffect, useRef, useState } from "react";
import { api, money, type Agreement } from "../lib/model";
import { createSingleFlight } from "../lib/payment-recovery";
import {
  blockerMessages,
  owedLines,
  pausedMessage,
  pausedView,
  PausedView,
  type RefundReviewState,
} from "../lib/refund-review";
import { Drawer } from "./allocation-drawer";
import { Button, Field, Notice } from "./ui";
import styles from "./refund-paused-banner.module.css";

/** Shown at the top of an agreement while payouts are paused after a refund. The organizer can
 * review who was paid more than the refund left them and resume; everyone else sees who is
 * reviewing. Mount once above the agreement tabs. */
export function RefundPausedBanner({
  agreement,
  userId,
  base,
  refresh,
}: {
  agreement: Agreement;
  userId: string;
  base: string;
  refresh: () => Promise<void>;
}) {
  const state = agreement.value as unknown as RefundReviewState;
  const view = pausedView(state, userId);
  const [reviewing, setReviewing] = useState(false);
  if (view === PausedView.NONE) return null;
  if (view === PausedView.COLLABORATOR)
    return (
      <div className={styles.banner}>
        <Notice warning>{pausedMessage(view, state)}</Notice>
      </div>
    );
  return (
    <div className={styles.banner}>
      <Notice warning>
        <span className={styles.row}>
          <strong>{pausedMessage(view, state)}</strong>
          <Button variant="secondary" onClick={() => setReviewing(true)}>
            Review
          </Button>
        </span>
      </Notice>
      {reviewing && (
        <Drawer label="Review the refund" onClose={() => setReviewing(false)}>
          <ResumeReview
            agreement={agreement}
            base={base}
            onDone={async () => {
              setReviewing(false);
              await refresh();
            }}
          />
        </Drawer>
      )}
    </div>
  );
}

function ResumeReview({
  agreement,
  base,
  onDone,
}: {
  agreement: Agreement;
  base: string;
  onDone: () => Promise<void>;
}) {
  const state = agreement.value as unknown as RefundReviewState;
  const lines = owedLines(state);
  const [blockers, setBlockers] = useState<string[] | null>(null),
    [credits, setCredits] = useState<
      { userId: string; name: string; cents: number }[]
    >([]),
    [offset, setOffset] = useState(false),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const flight = useRef(createSingleFlight());
  useEffect(() => {
    let active = true;
    api(`${base}/recovery`)
      .then((r) => {
        if (!active) return;
        setBlockers(r.review?.blockers ?? []);
        setCredits(r.review?.credits ?? []);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, agreement.revision]);
  const waiting = blockers ? blockerMessages(blockers) : [];
  return (
    <div className={styles.review}>
      {lines.length ? (
        <>
          <p>
            Some payouts went out before the refund. This is how much each
            person got that the refund took back:
          </p>
          <ul className={styles.owed}>
            {lines.map((line) => (
              <li key={line.userId}>
                <span>{line.name}</span>
                <strong>{money(line.cents)}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          Nobody was paid more than the refund left them. Resuming sends the
          payouts that are waiting.
        </p>
      )}
      {credits.length > 0 && (
        <>
          <p>
            Kept back earlier for a payout PayPal then returned. It’s added to
            their next payment:
          </p>
          <ul className={styles.owed}>
            {credits.map((line) => (
              <li key={line.userId}>
                <span>{line.name}</span>
                <strong>{money(line.cents)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
      {waiting.map((message) => (
        <Notice warning key={message}>
          {message}
        </Notice>
      ))}
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
        </div>
      )}
      {lines.length > 0 && (
        <Field
          label="Take it out of their next payments"
          hint="Each person’s amount comes off their share of the next payments until it’s paid back. Leave this off if it was settled another way."
        >
          <input
            type="checkbox"
            checked={offset}
            onChange={(e) => setOffset(e.target.checked)}
            disabled={busy}
          />
        </Field>
      )}
      <Field label="Note (optional)" hint="Saved with the agreement’s history.">
        <textarea
          value={note}
          maxLength={1000}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
        />
      </Field>
      <Button
        disabled={busy || !blockers || waiting.length > 0}
        onClick={() =>
          flight.current(async () => {
            setBusy(true);
            setError("");
            try {
              await api(`${base}/payments/resume`, "POST", {
                expectedRevision: agreement.revision,
                offsetFromFuturePayouts: lines.length > 0 && offset,
                ...(note.trim() ? { note: note.trim() } : {}),
              });
              await onDone();
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Payouts didn’t resume. Refresh and try again.",
              );
            } finally {
              setBusy(false);
            }
          })
        }
      >
        Resume payouts
      </Button>
    </div>
  );
}
