"use client";
import { useEffect, useRef } from "react";
import { ApiError, api } from "../lib/model";
import {
  PAYPAL_CALLBACK_PATH,
  PayPalConnectFlag,
  recallReturnPath,
  safeReturnPath,
  withPayPalFlag,
} from "./paypal-connect";

/**
 * PAYPAL_IDENTITY_RETURN_URL lands here. The session cookie is SameSite=strict,
 * so this same-origin page posts `code` and `state` to the API with the person's
 * own session, then sends them back to the page that started it with a flag.
 */
export function PayPalReturn() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    // Keep the one-time code out of history.
    window.history.replaceState(null, "", window.location.pathname);
    const fallback = recallReturnPath();
    const go = (path: string, flag: PayPalConnectFlag) =>
      window.location.replace(withPayPalFlag(path, flag));
    if (!code || !state) {
      go(fallback, PayPalConnectFlag.CANCELLED);
      return;
    }
    api<{ returnTo: string }>(PAYPAL_CALLBACK_PATH, "POST", { code, state })
      .then((result) =>
        go(safeReturnPath(result.returnTo), PayPalConnectFlag.CONNECTED),
      )
      .catch((error) =>
        go(
          fallback,
          error instanceof ApiError && error.code === "PAYPAL_EMAIL_UNVERIFIED"
            ? PayPalConnectFlag.UNVERIFIED
            : PayPalConnectFlag.FAILED,
        ),
      );
  }, []);
  return (
    <main className="paypal-return">
      <p role="status">Finishing with PayPal…</p>
    </main>
  );
}
