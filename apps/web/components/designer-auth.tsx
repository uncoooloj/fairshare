"use client";

import { useRef, useState } from "react";
import { useEmailDelivery } from "../lib/email-capability";
import { prepareAuthForm } from "../lib/auth-form";
import styles from "./designer-auth.module.css";
import { LogoMark } from "./logo-mark";

function Brand() {
  return (
    <div className={styles.brand}>
      <LogoMark />
      Fairshare
    </div>
  );
}

export function Auth({
  busy,
  error,
  codePrompt,
  onSubmit,
  onCancelCode,
}: {
  busy: boolean;
  error: string;
  /** Set when the password was accepted and the account needs an authenticator code. */
  codePrompt?: string;
  onSubmit: (type: string, data: Record<string, string>) => void;
  onCancelCode?: () => void;
}) {
  const emailDelivery = useEmailDelivery();
  const [login, setLogin] = useState(true);
  const [localError, setLocalError] = useState("");
  const [showServerError, setShowServerError] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const visibleError = localError || (showServerError ? error : "");
  const credentials = useRef<Record<string, string>>({});
  if (codePrompt)
    return (
      <main className={styles.page}>
        <Brand />
        <div className={styles.column}>
          <h1>Enter your authentication code</h1>
          <p className={styles.subtitle}>{codePrompt}</p>
          <form
            className={styles.form}
            aria-busy={busy}
            aria-describedby={error ? "auth-error" : undefined}
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              const code = String(
                new FormData(event.currentTarget).get("mfaCode") || "",
              ).trim();
              if (!code) return;
              onSubmit("login", { ...credentials.current, mfaCode: code });
            }}
          >
            {error && (
              <p id="auth-error" className={styles.error} role="alert">
                {error}
              </p>
            )}
            <label>
              Authenticator or recovery code
              <input
                name="mfaCode"
                autoComplete="one-time-code"
                inputMode="text"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={80}
                required
                autoFocus
                disabled={busy}
              />
            </label>
            <button className={styles.primary} disabled={busy}>
              {busy ? "Please wait…" : "Verify and sign in"}
            </button>
          </form>
          <p className={styles.switch}>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                credentials.current = {};
                onCancelCode?.();
              }}
            >
              Use a different account
            </button>
          </p>
        </div>
        <footer className={styles.footer}>Sandbox build. No live money.</footer>
      </main>
    );
  return (
    <main className={styles.page}>
      <Brand />
      <div className={styles.column}>
        <h1>
          {login
            ? "Welcome back to Fairshare"
            : "Create your Fairshare account"}
        </h1>
        <p className={styles.subtitle}>
          Turn signed agreements into clear, automatic splits.
        </p>
        <form
          className={styles.form}
          aria-busy={busy}
          aria-describedby={visibleError ? "auth-error" : undefined}
          onChange={() => setLocalError("")}
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const prepared = prepareAuthForm(
              login,
              Object.fromEntries(new FormData(event.currentTarget)) as Record<
                string,
                string
              >,
            );
            setLocalError(prepared.error);
            setShowServerError(true);
            if (prepared.error) {
              const field = event.currentTarget.elements.namedItem(
                !login && !prepared.data.name
                  ? "name"
                  : prepared.data.email.length > 254
                    ? "email"
                    : "password",
              );
              if (field instanceof HTMLInputElement) field.focus();
              return;
            }
            if (login) credentials.current = prepared.data;
            onSubmit(login ? "login" : "register", prepared.data);
          }}
        >
          {visibleError && (
            <p id="auth-error" className={styles.error} role="alert">
              {visibleError}
            </p>
          )}
          {!login && (
            <label>
              Full name
              <input
                name="name"
                autoComplete="name"
                required
                maxLength={80}
                disabled={busy}
              />
            </label>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              required
              disabled={busy}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              maxLength={256}
              autoComplete={login ? "current-password" : "new-password"}
              minLength={login ? 1 : 12}
              required
              disabled={busy}
              aria-describedby={!login ? "password-hint" : undefined}
            />
          </label>
          <button
            className={styles.reveal}
            type="button"
            disabled={busy}
            aria-pressed={showPassword}
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? "Hide password" : "Show password"}
          </button>
          {!login && (
            <p id="password-hint" className={styles.hint}>
              Use at least 12 characters. Use a synthetic account for sandbox
              testing.
            </p>
          )}
          <button className={styles.primary} disabled={busy}>
            {busy ? "Please wait…" : login ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className={styles.switch}>
          {login ? "New to Fairshare? " : "Already have an account? "}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setLogin(!login);
              setLocalError("");
              setShowServerError(false);
              setShowPassword(false);
            }}
          >
            {login ? "Create an account" : "Sign in"}
          </button>
        </p>
        {login && emailDelivery && (
          <p className={styles.hint}>
            <a href="/forgot-password">Forgot your password?</a>
          </p>
        )}
        <p className={styles.hint}>
          Email and password sign-in.{" "}
          {emailDelivery
            ? "Recovery requires a verified email."
            : "Keep your password somewhere safe. Password reset by email isn’t available yet."}{" "}
          Social sign-in is not available.
        </p>
      </div>
      <footer className={styles.footer}>Sandbox build. No live money.</footer>
    </main>
  );
}

/** Confirmation only. The parent owns token validation, API errors and success. */
export function AccessPrompt({
  kind,
  email,
  busy,
  onContinue,
  onCancel,
}: {
  kind: "verification" | "invitation";
  email: string;
  busy: boolean;
  onContinue: () => void;
  onCancel?: () => void;
}) {
  const isInvitation = kind === "invitation";
  const handleContinue = () => {
    if (!busy) onContinue();
  };

  return (
    <section className={styles.access} aria-busy={busy}>
      <h2>{isInvitation ? "You’ve been invited" : "Verify your email"}</h2>
      <p>
        {isInvitation
          ? "You will join using your signed-in account:"
          : "Confirm this verification link for"}{" "}
        <strong>{email}</strong>.
      </p>
      {isInvitation && (
        <p className={styles.hint}>
          Joining adds you to the team. The organizer must also add you to the
          agreement before you can review and approve its rules. It does not
          approve an agreement or change anyone’s share.
        </p>
      )}
      <button
        className={styles.primary}
        disabled={busy}
        onClick={handleContinue}
      >
        {busy
          ? "Please wait…"
          : isInvitation
            ? "Accept invitation"
            : "Verify email"}
      </button>
      {isInvitation && onCancel && (
        <button type="button" disabled={busy} onClick={onCancel}>
          Not now
        </button>
      )}
    </section>
  );
}
