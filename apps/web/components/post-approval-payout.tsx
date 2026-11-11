"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/model";
import { Button } from "./ui";
/** Approval has already succeeded. Account setup is independent and can be postponed. */
export function PostApprovalPayout({
  base,
  onSetup,
  onDismiss,
}: {
  base: string;
  onSetup: () => void;
  onDismiss: () => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    api(`${base}/recipient-status`)
      .then((r) => {
        if (live) setConfigured(r.configured);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [base]);
  return (
    <section className="panel" aria-label="Payout setup after approval">
      <h3>Your approval is saved</h3>
      {configured === null && !error ? (
        <p role="status">Checking your payout setup…</p>
      ) : configured ? (
        <p>
          Your payout destination is already saved. This is not a guarantee of
          provider verification or a completed payout.
        </p>
      ) : (
        <>
          <p>
            {error
              ? "Your payout setup could not be checked. You can review it in People."
              : "Add your payout destination so your share can be sent when payments arrive. You can do this later without losing your approval."}
          </p>
          <Button onClick={onSetup}>Set up my payout account</Button>
        </>
      )}
      <Button variant="secondary" onClick={onDismiss}>
        {configured ? "Done" : "Later"}
      </Button>
    </section>
  );
}
