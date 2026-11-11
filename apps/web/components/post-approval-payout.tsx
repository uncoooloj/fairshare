"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/model";
import { Button } from "./ui";
import { PayoutEmailStep, PayoutStepResult } from "./payout-email-step";

/**
 * "Where should we send your share?" after approving. The approval is already
 * saved; this step only saves a payout email when the person submits it, and
 * can always be skipped with "Do this later".
 */
export function PostApprovalPayout({
  base,
  onDone,
}: {
  base: string;
  onDone: () => void;
}) {
  const [configured, setConfigured] = useState(false);
  const [saved, setSaved] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let live = true;
    api(`${base}/recipient-status`)
      .then((r) => {
        if (live) setConfigured(r.configured);
      })
      // If the check fails, the email step still works; it loads the saved email itself.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [base]);
  const ready = configured || saved;
  useEffect(() => {
    if (ready) heading.current?.focus();
  }, [ready]);
  return (
    <section
      className="collab-review collab-payout"
      aria-label="Your share after approval"
    >
      <span className="collab-check" aria-hidden="true">
        ✓
      </span>
      <p className="collab-eyebrow">You approved</p>
      {ready ? (
        <>
          <h2 ref={heading} tabIndex={-1} className="collab-title">
            You’re ready to get paid
          </h2>
          <p className="muted">
            {saved
              ? "Saved. Your share goes to this PayPal email when payments come in."
              : "Your PayPal email is already saved."}
          </p>
          <div className="collab-payout-actions">
            <Button onClick={onDone}>Done</Button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Your approval is already saved.</p>
          <PayoutEmailStep
            autoFocus
            onDone={(result) => {
              if (result === PayoutStepResult.SAVED) setSaved(true);
              else onDone();
            }}
          />
        </>
      )}
    </section>
  );
}
