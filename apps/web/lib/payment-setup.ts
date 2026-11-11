"use client";
import { useEffect, useState } from "react";
import { api } from "./model";

/** Mirrors the API's PaymentConfirmation. */
export enum PaymentConfirmation {
  READY = "READY",
  WEBHOOK_NOT_CONFIGURED = "WEBHOOK_NOT_CONFIGURED",
  NOT_CONFIGURED = "NOT_CONFIGURED",
}
export interface PaymentSetup {
  automaticPayouts: boolean;
  /** Added after initial setup responses; absent means an older API response. */
  payoutsReady?: boolean;
  paymentConfirmation: PaymentConfirmation;
}
/** Mirrors the API's PayoutWaitReason. */
export enum PayoutWaitReason {
  NEEDS_PAYOUT_EMAIL = "NEEDS_PAYOUT_EMAIL",
  ON_HOLD = "ON_HOLD",
}
export interface DispatchResult {
  userId: string;
  status: string;
  reason?: PayoutWaitReason;
}

export const WEBHOOK_NOT_CONFIGURED_NOTICE =
  "Payments can’t be confirmed yet: webhook not configured.";
export const PAYMENT_NOT_CONFIGURED_NOTICE =
  "Payments aren’t configured yet: connect PayPal before accepting or sending payments.";

/** Copy under the manual send button. Says nothing until the server answers. */
export function automaticPayoutCopy(setup: PaymentSetup | null): string {
  if (!setup) return "Technical sandbox dispatch, not a vote on the shares.";
  if (setup.paymentConfirmation === PaymentConfirmation.NOT_CONFIGURED)
    return "Technical sandbox dispatch, not a vote on the shares. Payments aren’t configured yet, so payouts can’t be sent.";
  if (setup.payoutsReady === false)
    return "Technical sandbox dispatch, not a vote on the shares. Payouts aren’t ready yet, so they can’t be sent.";
  return setup.automaticPayouts
    ? "Technical sandbox dispatch, not a vote on the shares. Automatic payouts are on: people who are ready are paid without this button."
    : "Technical sandbox dispatch, not a vote on the shares. Automatic payouts are off, so use this button to send.";
}

/** Organizer-only warning when PayPal can't confirm anything back to us. */
export function paymentConfirmationNotice(
  setup: PaymentSetup | null,
): string | null {
  if (setup?.paymentConfirmation === PaymentConfirmation.NOT_CONFIGURED)
    return PAYMENT_NOT_CONFIGURED_NOTICE;
  return setup?.paymentConfirmation ===
    PaymentConfirmation.WEBHOOK_NOT_CONFIGURED
    ? WEBHOOK_NOT_CONFIGURED_NOTICE
    : null;
}

/** Plain summary of a manual dispatch: who was sent, who waits and why. */
export function dispatchSummary(
  results: readonly DispatchResult[],
  nameOf: (userId: string) => string,
): string {
  const sent = results.filter((r) => r.status === "PENDING").length;
  const parts = [
    sent
      ? `Sent ${sent} payout${sent === 1 ? "" : "s"} to PayPal. Sending isn’t the same as paid; check each status.`
      : "Nothing new was sent.",
  ];
  for (const r of results) {
    if (r.reason === PayoutWaitReason.NEEDS_PAYOUT_EMAIL)
      parts.push(`Waiting for ${nameOf(r.userId)}’s PayPal email.`);
    else if (r.reason === PayoutWaitReason.ON_HOLD)
      parts.push(`${nameOf(r.userId)}’s payout is on hold.`);
    else if (r.status === "OUTCOME_UNKNOWN")
      parts.push(`Checking with PayPal for ${nameOf(r.userId)}.`);
  }
  return parts.join(" ");
}

export function usePaymentSetup(base: string): PaymentSetup | null {
  const [setup, setSetup] = useState<PaymentSetup | null>(null);
  useEffect(() => {
    let active = true;
    setSetup(null);
    api<PaymentSetup>(`${base}/payments/setup`)
      .then((result) => {
        if (active) setSetup(result);
      })
      .catch(() => {
        /* Neutral copy stays; nothing is claimed either way. */
      });
    return () => {
      active = false;
    };
  }, [base]);
  return setup;
}
