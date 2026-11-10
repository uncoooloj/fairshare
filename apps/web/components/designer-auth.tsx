"use client";

import { useRef, useState, type ReactNode } from "react";
import { prepareAuthForm } from "../lib/auth-form";
import styles from "./designer-auth.module.css";

function Brand() {
  return (
    <div className={styles.brand}>
      <span className={styles.mark} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      Fairshare
    </div>
  );
}

export function Auth({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string;
  onSubmit: (type: string, data: Record<string, string>) => void;
}) {
  const [login, setLogin] = useState(true);
  const [localError, setLocalError] = useState("");
  const [showServerError, setShowServerError] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const visibleError = localError || (showServerError ? error : "");
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
          {login && (
            <p className={styles.hint}>
              If your test account has hackathon MFA simulation enabled, enter
              any nonempty value below. Simulation is not account protection.
            </p>
          )}
          {login && (
            <label>
              Authenticator or recovery code (if enabled)
              <input
                name="mfaCode"
                autoComplete="one-time-code"
                maxLength={80}
                disabled={busy}
              />
            </label>
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
        {login && (
          <p className={styles.hint}>
            <a href="/forgot-password">Forgot your password?</a>
          </p>
        )}
        <p className={styles.hint}>
          Email and password sign-in. Recovery requires a verified email and
          configured email delivery. Social sign-in is not available.
        </p>
      </div>
      <footer className={styles.footer}>Sandbox build. No live money.</footer>
    </main>
  );
}

function workspaceOnboardingCopy(section: string) {
  switch (section) {
    case "Agreements":
      return {
        title: "Your agreements start here",
        description:
          "Create a workspace to upload your first agreement, invite collaborators and agree how revenue is shared.",
      };
    case "Payouts":
      return {
        title: "No payouts yet",
        description:
          "Payouts will appear here when an agreement has approved rules and recorded payments. Start by creating your workspace.",
      };
    default:
      return {
        title: "Create your workspace",
        description:
          "A shared home for your agreements, collaborators and payment activity.",
      };
  }
}

/** Uses the existing POST /workspaces callback; never advances before API success. */
export function WorkspaceOnboarding({
  busy,
  error,
  onCreate,
  section = "Overview",
}: {
  busy: boolean;
  error?: string;
  section?: string;
  onCreate: (name: string) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const submitting = useRef(false);
  const [creating, setCreating] = useState(false);
  const { title, description } = workspaceOnboardingCopy(section);
  return (
    <section className={styles.welcome}>
      <h1>{title}</h1>
      <p className={styles.subtitle}>{description}</p>
      <form
        className={styles.setup}
        aria-busy={busy}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || submitting.current || !name.trim()) return;
          submitting.current = true;
          setCreating(true);
          try {
            await onCreate(name.trim());
          } finally {
            submitting.current = false;
            setCreating(false);
          }
        }}
      >
        {section !== "Overview" && <h2>Create your workspace</h2>}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <label>
          Workspace name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={100}
            disabled={busy}
            placeholder="Your team or studio"
            autoComplete="organization"
          />
        </label>
        <button className={styles.primary} disabled={busy || !name.trim()}>
          {creating ? "Creating workspace…" : "Create workspace"}
        </button>
        <p className={styles.hint}>
          Already invited? Open Settings to accept your workspace invitation.
        </p>
      </form>
      <details className={styles.explainer}>
        <summary>How Fairshare works</summary>
        <div className={styles.steps}>
          <Step number="1" title="Upload agreement">
            Add the signed document. We read the revenue clauses.
          </Step>
          <Step number="2" title="Everyone approves">
            Each person checks the rules against the clauses and approves.
          </Step>
          <Step number="3" title="Payments follow the rules">
            Recorded revenue is allocated by the approved rules. Track payout
            status separately.
          </Step>
        </div>
      </details>
    </section>
  );
}
function Step({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.step}>
      <span>{number}</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

/** Confirmation only. The parent owns token validation, API errors and success. */
export function AccessPrompt({
  kind,
  email,
  busy,
  onContinue,
}: {
  kind: "verification" | "invitation";
  email: string;
  busy: boolean;
  onContinue: () => void;
}) {
  return (
    <section className={styles.access} aria-busy={busy}>
      <h2>
        {kind === "verification" ? "Verify your email" : "You’ve been invited"}
      </h2>
      <p>
        {kind === "verification"
          ? "Confirm this verification link for"
          : "You will join using your signed-in account:"}{" "}
        <strong>{email}</strong>.
      </p>
      {kind === "invitation" && (
        <p className={styles.hint}>
          Joining adds you to the workspace. The organizer must also add you to
          the agreement before you can review and approve its rules. It does not
          approve an agreement or change anyone’s share.
        </p>
      )}
      <button
        className={styles.primary}
        disabled={busy}
        onClick={() => {
          if (!busy) onContinue();
        }}
      >
        {busy
          ? "Please wait…"
          : kind === "verification"
            ? "Verify email"
            : "Accept invitation"}
      </button>
    </section>
  );
}
