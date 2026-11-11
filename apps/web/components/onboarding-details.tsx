"use client";

import { useState } from "react";
import { LogoMark } from "./logo-mark";
import styles from "./onboarding-details.module.css";

function Brand() {
  return (
    <div className={styles.brand}>
      <LogoMark />
      Fairshare
    </div>
  );
}

export function OnboardingWelcome({ onStart }: { onStart: () => void }) {
  return (
    <main className={styles.page}>
      <Brand />
      <section className={styles.column} aria-labelledby="onboarding-title">
        <h1 id="onboarding-title">Here’s how Fairshare works</h1>
        <ol className={styles.steps}>
          <li>
            <span className={styles.number}>1</span>
            <div>
              <h2>Upload agreement</h2>
              <p>
                Add the signed PDF or Word file. We read the revenue clauses.
              </p>
            </div>
          </li>
          <li>
            <span className={styles.number}>2</span>
            <div>
              <h2>Everyone approves</h2>
              <p>
                Each person checks the rules against the clauses and approves.
              </p>
            </div>
          </li>
          <li>
            <span className={styles.number}>3</span>
            <div>
              <h2>Payments split automatically</h2>
              <p>
                Every payment is divided by the approved rules and paid out.
              </p>
            </div>
          </li>
        </ol>
        <button className={styles.primary} onClick={onStart}>
          Get started
        </button>
      </section>
      <footer className={styles.footer}>Sandbox build. No live money.</footer>
    </main>
  );
}

export function OnboardingDetails({
  name,
  onSave,
}: {
  name: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className={styles.page}>
      <Brand />
      <form
        className={styles.column}
        aria-busy={busy}
        onSubmit={async (event) => {
          event.preventDefault();
          const next = draft.trim();
          if (!next || busy) return;
          setBusy(true);
          setError("");
          try {
            await onSave(next);
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Your details could not be saved. Please try again.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className={styles.step}>Step 1 of 2</span>
        <h1>A couple of details</h1>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <label>
          Full name
          <input
            name="name"
            autoComplete="name"
            maxLength={80}
            required
            autoFocus
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <label>
          Default currency
          <span className={styles.fixedValue}>🇺🇸 USD – US dollar</span>
        </label>
        <p className={styles.hint}>
          You can set a different currency per agreement.
        </p>
        <button className={styles.primary} disabled={busy || !draft.trim()}>
          {busy ? "Saving…" : "Continue"}
        </button>
      </form>
      <footer className={styles.footer}>Sandbox build. No live money.</footer>
    </main>
  );
}
