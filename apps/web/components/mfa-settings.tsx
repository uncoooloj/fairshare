"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/model";
import { Button, Field } from "./ui";
type Status = {
  available: boolean;
  enabled: boolean;
  recoveryCodesRemaining: number;
};
export function MfaSettings({ onSignOut }: { onSignOut: () => void }) {
  const [status, setStatus] = useState<Status | null>(null),
    [setup, setSetup] = useState<{ secret: string; expiresAt: number } | null>(
      null,
    ),
    [recovery, setRecovery] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    api("auth/mfa")
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active)
          setError(
            "Could not load authenticator settings. Reload to try again.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(
    form: HTMLFormElement,
    action: "setup" | "activate" | "disable" | "cancel",
  ) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const data = new FormData(form);
    try {
      const result = await api(
        `auth/mfa/${action}`,
        "POST",
        action === "cancel"
          ? {}
          : action === "activate"
            ? { code: String(data.get("code")) }
            : {
                password: String(data.get("password")),
                ...(action === "disable"
                  ? { code: String(data.get("code")) }
                  : {}),
              },
      );
      form.reset();
      if (action === "setup") setSetup(result);
      if (action === "cancel") setSetup(null);
      if (action === "activate") {
        setSetup(null);
        setRecovery(result.recoveryCodes);
      }
      if (action === "disable") onSignOut();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not update authenticator settings.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Authenticator security</h2>
      <p className="muted">
        Require a six-digit authenticator code when you sign in. Recovery codes
        are single-use; store them somewhere private.
      </p>
      {error && <p role="alert">{error}</p>}
      {!!recovery.length ? (
        <>
          <h3>Authenticator enabled</h3>
          <p>
            Save these recovery codes now. They will not be shown again. All
            previous sessions have been signed out. Wait for the next
            authenticator code before signing in, or use a recovery code.
          </p>
          <ul>
            {recovery.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
          <Button
            onClick={() => {
              setRecovery([]);
              onSignOut();
            }}
          >
            I saved my codes. Sign in
          </Button>
        </>
      ) : !status ? (
        <p>Loading security settings…</p>
      ) : !status.available ? (
        <p>
          Authenticator setup and verification are unavailable until the
          operator configures secure key storage.{" "}
          {status.enabled ? "Your authenticator remains enabled." : ""}
        </p>
      ) : setup ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget, "activate");
          }}
        >
          <p>
            In your authenticator app, add a time-based code for Fairshare using
            this setup key. It expires in ten minutes.
          </p>
          <p>
            <code>{setup.secret}</code>
          </p>
          <Field label="Six-digit authenticator code">
            <input
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              disabled={busy}
            />
          </Field>
          <Button disabled={busy}>
            {busy
              ? "Verifying…"
              : "Enable authenticator and show recovery codes"}
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={busy}
            onClick={(event) => {
              const form = event.currentTarget.closest("form");
              if (form) void submit(form, "cancel");
            }}
          >
            Cancel setup
          </Button>
        </form>
      ) : status.enabled ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget, "disable");
          }}
        >
          <p>
            Enabled · {status.recoveryCodesRemaining} recovery codes remaining.
            Disabling requires your password and an unused code and signs out
            every session.
          </p>
          <Field label="Current password">
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              maxLength={256}
              disabled={busy}
            />
          </Field>
          <Field label="Authenticator or recovery code">
            <input
              name="code"
              autoComplete="one-time-code"
              required
              maxLength={80}
              disabled={busy}
            />
          </Field>
          <Button variant="secondary" disabled={busy}>
            {busy ? "Disabling…" : "Disable authenticator and sign out"}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget, "setup");
          }}
        >
          <p>
            Not enabled. Setup will not change sign-in until you verify an
            authenticator code.
          </p>
          <Field label="Confirm current password">
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              maxLength={256}
              disabled={busy}
            />
          </Field>
          <Button disabled={busy}>
            {busy ? "Preparing…" : "Set up authenticator"}
          </Button>
        </form>
      )}
    </section>
  );
}
