"use client";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/model";
import { Button, Notice } from "./ui";

/** Self-only route. One PayPal email per person, used for all their agreements. */
export const PAYOUT_ACCOUNT_PATH = "auth/payout-account";

/** Mirrors the API's RecipientType. */
export enum PayoutRecipientType {
  EMAIL = "EMAIL",
  PAYPAL_ID = "PAYPAL_ID",
}
/** What other people see about someone's payout destination (never the address). */
export enum PayoutReadiness {
  READY = "READY",
  NEEDS_EMAIL = "NEEDS_EMAIL",
}
export enum PayoutStepResult {
  SAVED = "SAVED",
  LATER = "LATER",
}
export type PayoutDestination = {
  type: PayoutRecipientType;
  value: string;
  updatedAt: number | null;
};
export type PayoutAccount = {
  destination: PayoutDestination | null;
  suggestedEmail: string | null;
};

export function payoutReadinessLabel(status: string | undefined) {
  if (status === PayoutReadiness.READY) return "Ready to be paid";
  if (status === PayoutReadiness.NEEDS_EMAIL) return "Needs a payout email";
  return "Status unavailable";
}
/** Plain copy for a PayPal UNCLAIMED payout. Not a failure, and never retried. */
export function unclaimedPayoutLabel(name: string) {
  return `Waiting for ${name} to claim it`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizePayoutEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= 127 && EMAIL.test(email) ? email : null;
}
export function loadPayoutAccount(workspaceId?: string) {
  return api<PayoutAccount>(
    workspaceId
      ? `${PAYOUT_ACCOUNT_PATH}?workspaceId=${encodeURIComponent(workspaceId)}`
      : PAYOUT_ACCOUNT_PATH,
  );
}
export function savePayoutEmail(email: string) {
  return api<{ destination: PayoutDestination }>(PAYOUT_ACCOUNT_PATH, "PUT", {
    email,
  });
}

/**
 * "Where should we send your share?" The suggestion (the person's login email)
 * is shown in the field, but nothing is saved until they press Save.
 */
export function PayoutEmailStep({
  onDone,
  autoFocus = true,
}: {
  onDone: (result: PayoutStepResult, destination?: PayoutDestination) => void;
  autoFocus?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const fieldId = useId();
  const hintId = useId();
  useEffect(() => {
    if (autoFocus) heading.current?.focus();
    let live = true;
    loadPayoutAccount()
      .then((account) => {
        if (!live) return;
        const current =
          account.destination?.type === PayoutRecipientType.EMAIL
            ? account.destination.value
            : null;
        setEmail(current ?? account.suggestedEmail ?? "");
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [autoFocus]);
  return (
    <form
      className="collab-payout-form"
      aria-labelledby={`${fieldId}-heading`}
      onSubmit={async (event) => {
        event.preventDefault();
        const normalized = normalizePayoutEmail(email);
        if (!normalized) {
          setError("Enter the email you use for PayPal.");
          return;
        }
        setError("");
        setSaving(true);
        try {
          const result = await savePayoutEmail(normalized);
          onDone(PayoutStepResult.SAVED, result.destination);
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "That didn’t save. Try again.",
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <h2
        id={`${fieldId}-heading`}
        ref={heading}
        tabIndex={-1}
        className="collab-title"
      >
        Where should we send your share?
      </h2>
      <p id={hintId} className="muted">
        Enter the email you use for PayPal. If you don’t have PayPal yet,
        they’ll email you a link to claim it.
      </p>
      <label htmlFor={fieldId}>PayPal email</label>
      <input
        id={fieldId}
        type="email"
        inputMode="email"
        autoComplete="email"
        spellCheck={false}
        aria-describedby={hintId}
        maxLength={127}
        value={email}
        disabled={saving || !loaded}
        onChange={(event) => setEmail(event.target.value)}
      />
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
        </div>
      )}
      <div className="collab-payout-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={saving}
          onClick={() => onDone(PayoutStepResult.LATER)}
        >
          Do this later
        </Button>
        <Button type="submit" disabled={saving || !email.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
