"use client";

import { useState, type ReactNode } from "react";
import styles from "./designer-auth.module.css";

function Brand() {
  return <div className={styles.brand}><span className={styles.mark} aria-hidden="true"><i /><i /><i /></span>Fairshare</div>;
}

export function Auth({ busy, error, onSubmit }: {
  busy: boolean;
  error: string;
  onSubmit: (type: string, data: Record<string, string>) => void;
}) {
  const [login, setLogin] = useState(true);
  return <main className={styles.page}>
    <Brand />
    <div className={styles.column}>
      <h1>{login ? "Welcome back to Fairshare" : "Create your Fairshare account"}</h1>
      <p className={styles.subtitle}>Turn signed agreements into clear, automatic splits.</p>
      <form className={styles.form} aria-busy={busy} onSubmit={event => {
        event.preventDefault();
        if (busy) return;
        onSubmit(login ? "login" : "register", Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>);
      }}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!login && <label>Full name<input name="name" autoComplete="name" required maxLength={80} disabled={busy} /></label>}
        <label>Email<input name="email" type="email" autoComplete="email" required disabled={busy} /></label>
        <label>Password<input name="password" type="password" autoComplete={login ? "current-password" : "new-password"} minLength={login ? 1 : 12} required disabled={busy} aria-describedby={!login ? "password-hint" : undefined} /></label>
        {!login && <p id="password-hint" className={styles.hint}>Use at least 12 characters. Use a synthetic account for sandbox testing.</p>}
        <button className={styles.primary} disabled={busy}>{busy ? "Please wait…" : login ? "Sign in" : "Create account"}</button>
      </form>
      <p className={styles.switch}>{login ? "New to Fairshare? " : "Already have an account? "}<button type="button" disabled={busy} onClick={() => setLogin(!login)}>{login ? "Create an account" : "Sign in"}</button></p>
      <p className={styles.hint}>Email and password sign-in is available in this build. Password recovery and social sign-in are not yet available.</p>
    </div>
    <footer className={styles.footer}>Sandbox build. No live money.</footer>
  </main>;
}

/** Uses the existing POST /workspaces callback; never advances before API success. */
export function WorkspaceOnboarding({ busy, error, onCreate }: {
  busy: boolean; error?: string; onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return <section className={styles.welcome}>
    <h1>Here’s how Fairshare works</h1>
    <div className={styles.steps}>
      <Step number="1" title="Upload agreement">Add the signed document. We read the revenue clauses.</Step>
      <Step number="2" title="Everyone approves">Each person checks the rules against the clauses and approves.</Step>
      <Step number="3" title="Payments follow the rules">Recorded revenue is allocated by the approved rules. Track payout status separately.</Step>
    </div>
    <div className={styles.example}>
      <strong>Example: $3,000 payment</strong><p>Maya $2,500 · Jordan $300 · Riley $200</p>
      <div className={styles.split} aria-hidden="true"><i /><i /><i /></div>
      <p className={styles.hint}>Maya recoups her $2,000 advance first, then the remaining $1,000 splits 50 / 30 / 20. Illustrative amounts, not account activity.</p>
    </div>
    <form className={styles.setup} aria-busy={busy} onSubmit={event => { event.preventDefault(); if (!busy && name.trim()) onCreate(name.trim()); }}>
      <h2>Start with your workspace</h2><p className={styles.hint}>A shared home for your agreements and collaborators.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <label>Workspace name<input value={name} onChange={event => setName(event.target.value)} required maxLength={120} disabled={busy} placeholder="Your team or studio" /></label>
      <button className={styles.primary} disabled={busy || !name.trim()}>{busy ? "Creating workspace…" : "Create workspace"}</button>
    </form>
  </section>;
}
function Step({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return <div className={styles.step}><span>{number}</span><h2>{title}</h2><p>{children}</p></div>;
}

/** Confirmation only. The parent owns token validation, API errors and success. */
export function AccessPrompt({ kind, email, busy, onContinue }: {
  kind: "verification" | "invitation"; email: string; busy: boolean; onContinue: () => void;
}) {
  return <section className={styles.access} aria-busy={busy}>
    <h2>{kind === "verification" ? "Verify your email" : "You’ve been invited"}</h2>
    <p>{kind === "verification" ? "Confirm this verification link for" : "Accept the invitation using the account it was sent to:"} <strong>{email}</strong>.</p>
    {kind === "invitation" && <p className={styles.hint}>Joining gives you access to review. It does not approve an agreement or change anyone’s share.</p>}
    <button className={styles.primary} disabled={busy} onClick={() => { if (!busy) onContinue(); }}>{busy ? "Please wait…" : kind === "verification" ? "Verify email" : "Accept invitation"}</button>
  </section>;
}
