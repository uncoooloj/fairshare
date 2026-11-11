"use client";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/model";
import { Button, Notice } from "./ui";
import {
  PayPalConnectChoice,
  paypalFlagMessage,
  takePayPalConnectFlag,
  type PayPalConnectFlag,
} from "./paypal-connect";

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
  /** True only when PayPal returned this email via "Connect with PayPal". */
  verified: boolean;
  verifiedAt: number | null;
};
export type PayoutAccount = {
  destination: PayoutDestination | null;
  suggestedEmail: string | null;
  /** Whether "Connect with PayPal" is configured on the server. */
  paypalConnect: boolean;
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

/** Where the step is shown. Settings has its own card title, so no heading
 * and no "Do this later" there. */
export enum PayoutStepPlace {
  AFTER_APPROVAL = "AFTER_APPROVAL",
  SETTINGS = "SETTINGS",
}

/**
 * "Where should we send your money?" The suggestion (the person's login email)
 * is shown in the field, but nothing is saved until they press Save.
 */
export function PayoutEmailStep({
  onDone,
  onCancel,
  autoFocus = true,
  place = PayoutStepPlace.AFTER_APPROVAL,
}: {
  onDone: (result: PayoutStepResult, destination?: PayoutDestination) => void;
  /** Settings only: shown as Cancel when changing a saved email. */
  onCancel?: () => void;
  autoFocus?: boolean;
  place?: PayoutStepPlace;
}) {
  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [paypalConnect, setPayPalConnect] = useState(false);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [flag, setFlag] = useState<PayPalConnectFlag | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const fieldId = useId();
  const hintId = useId();
  const noteId = useId();
  const inSettings = place === PayoutStepPlace.SETTINGS;
  useEffect(() => {
    if (autoFocus) heading.current?.focus();
    setFlag(takePayPalConnectFlag());
    let live = true;
    loadPayoutAccount()
      .then((account) => {
        if (!live) return;
        const current =
          account.destination?.type === PayoutRecipientType.EMAIL
            ? account.destination.value
            : null;
        setEmail(current ?? account.suggestedEmail ?? "");
        setChanging(account.destination !== null);
        setPayPalConnect(account.paypalConnect === true);
        setVerifiedEmail(
          account.destination?.verified ? account.destination.value : null,
        );
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
      aria-labelledby={inSettings ? undefined : `${fieldId}-heading`}
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
      {!inSettings && (
        <h2
          id={`${fieldId}-heading`}
          ref={heading}
          tabIndex={-1}
          className="collab-title"
        >
          Where should we send your money?
        </h2>
      )}
      {flag && (
        <div role="status">
          <Notice>{paypalFlagMessage(flag)}</Notice>
        </div>
      )}
      <PayPalConnectChoice
        available={paypalConnect}
        verifiedEmail={verifiedEmail}
        disabled={saving}
        onDisconnected={() => setVerifiedEmail(null)}
      />
      <label htmlFor={fieldId}>PayPal email</label>
      <input
        id={fieldId}
        type="email"
        inputMode="email"
        autoComplete="email"
        spellCheck={false}
        aria-describedby={changing ? `${hintId} ${noteId}` : hintId}
        maxLength={127}
        value={email}
        disabled={saving || !loaded}
        onChange={(event) => setEmail(event.target.value)}
      />
      <p id={hintId} className="payout-field-hint muted">
        No PayPal yet? You’ll get an email to claim it.
      </p>
      {changing && (
        <p id={noteId} className="payout-field-hint muted">
          Payments already on their way keep the old address.
        </p>
      )}
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
        </div>
      )}
      <div className="collab-payout-actions">
        {!inSettings && (
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => onDone(PayoutStepResult.LATER)}
          >
            Do this later
          </Button>
        )}
        {inSettings && onCancel && (
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={saving || !email.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
