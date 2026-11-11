"use client";
import { useState } from "react";
import { api } from "../lib/model";
import { Button, Notice } from "./ui";

/** Self-only "Connect with PayPal" (sandbox Log in with PayPal). */
export const PAYPAL_CONNECT_PATH = "auth/paypal/connect";
export const PAYPAL_CALLBACK_PATH = "auth/paypal/callback";
/** Query flag the return page adds to the page that started the flow. */
export const PAYPAL_FLAG = "paypal";
const RETURN_KEY = "fairshare.paypal.returnTo";
const SANDBOX_AUTHORIZE = "https://www.sandbox.paypal.com/";

/** Mirrors the API's PayPalConnectResult. */
export enum PayPalConnectFlag {
  CONNECTED = "connected",
  UNVERIFIED = "unverified",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

/** `m•••@gmail.com`. Shown to the owner only; organizers never get the address. */
export function maskPayoutEmail(email: string) {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

export function paypalFlagMessage(flag: PayPalConnectFlag | null) {
  switch (flag) {
    case PayPalConnectFlag.CONNECTED:
      return "PayPal confirmed your account. Your share will go there.";
    case PayPalConnectFlag.UNVERIFIED:
      return "PayPal hasn’t confirmed the email on that account yet. Confirm it with PayPal, or enter your PayPal email instead.";
    case PayPalConnectFlag.FAILED:
      return "We couldn’t connect PayPal. Try again, or enter your PayPal email instead.";
    case PayPalConnectFlag.CANCELLED:
      return "PayPal wasn’t connected. Nothing changed.";
    default:
      return "";
  }
}

/** Same-origin path, or the app home. Never a full URL. */
export function safeReturnPath(value: string | null | undefined) {
  return value && /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]{0,300}$/.test(value)
    ? value
    : "/app";
}
export function withPayPalFlag(path: string, flag: PayPalConnectFlag) {
  const url = new URL(safeReturnPath(path), "https://fairshare.invalid");
  url.searchParams.set(PAYPAL_FLAG, flag);
  return url.pathname + url.search;
}

/** Reads the outcome flag once and removes it from the address bar. */
export function takePayPalConnectFlag(): PayPalConnectFlag | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const value = url.searchParams.get(PAYPAL_FLAG);
  if (!value) return null;
  url.searchParams.delete(PAYPAL_FLAG);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return (Object.values(PayPalConnectFlag) as string[]).includes(value)
    ? (value as PayPalConnectFlag)
    : null;
}

export function rememberReturnPath(path: string) {
  try {
    sessionStorage.setItem(RETURN_KEY, safeReturnPath(path));
  } catch {
    // The server-held return path is used on success; this is only a fallback.
  }
}
export function recallReturnPath() {
  try {
    const value = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return safeReturnPath(value);
  } catch {
    return "/app";
  }
}

async function startPayPalConnect() {
  const url = new URL(window.location.href);
  url.searchParams.delete(PAYPAL_FLAG);
  const returnTo = safeReturnPath(url.pathname + url.search);
  rememberReturnPath(returnTo);
  const { authorizeUrl } = await api<{ authorizeUrl: string }>(
    `${PAYPAL_CONNECT_PATH}?returnTo=${encodeURIComponent(returnTo)}`,
  );
  if (!authorizeUrl.startsWith(SANDBOX_AUTHORIZE))
    throw new Error("We couldn’t start PayPal. Try again.");
  window.location.assign(authorizeUrl);
}

/** PayPal-styled button (gold, wordmark in PayPal blues) in plain HTML/CSS. */
export function PayPalConnectButton({ disabled }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="paypal-connect">
      <button
        type="button"
        className="paypal-connect-button"
        disabled={disabled || busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await startPayPalConnect();
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "We couldn’t start PayPal. Try again.",
            );
            setBusy(false);
          }
        }}
      >
        <span>{busy ? "Opening" : "Connect with"}</span>
        <span className="paypal-wordmark" aria-label="PayPal">
          <span className="paypal-wordmark-pay">Pay</span>
          <span className="paypal-wordmark-pal">Pal</span>
        </span>
      </button>
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
        </div>
      )}
    </div>
  );
}

/** "Connected · m•••@gmail.com · Verified by PayPal", with a quiet Disconnect. */
export function PayPalConnected({
  email,
  onDisconnected,
  canEdit = true,
}: {
  email: string;
  onDisconnected?: () => void;
  canEdit?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="paypal-connected">
      <span>
        Connected · {maskPayoutEmail(email)} ·{" "}
        <strong className="paypal-verified">Verified by PayPal</strong>
      </span>
      {canEdit && (
        <Button
          type="button"
          variant="quiet"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api(PAYPAL_CONNECT_PATH, "DELETE");
              onDisconnected?.();
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Couldn’t disconnect. Try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Disconnect
        </Button>
      )}
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
        </div>
      )}
    </div>
  );
}

/** The connect option inside the payout email step: the verified line, the
 * button, or nothing when Identity isn't configured on the server. */
export function PayPalConnectChoice({
  available,
  verifiedEmail,
  disabled,
  onDisconnected,
}: {
  available: boolean;
  verifiedEmail: string | null;
  disabled?: boolean;
  onDisconnected?: () => void;
}) {
  if (verifiedEmail)
    return (
      <PayPalConnected email={verifiedEmail} onDisconnected={onDisconnected} />
    );
  if (!available) return null;
  return (
    <>
      <PayPalConnectButton disabled={disabled} />
      <p className="paypal-or">Or type it yourself</p>
    </>
  );
}
