"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/model";
import { Button, Field, Notice } from "./ui";
type Status = {
  simulated?: boolean;
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
        if (result.simulated) {
          onSignOut();
          return;
        }
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
      <h2>
        {status?.simulated ? "Hackathon MFA simulation" : "Two-step sign-in"}
      </h2>
      {status?.simulated && (
        <p role="status">
          SANDBOX ONLY · This is a simulated step, not account protection. Enter
          any nonempty value to continue. No authenticator app or recovery codes
          are needed. Your password is still required.
        </p>
      )}
      {status && !status.simulated && (
        <p className="muted">
          Ask for a code from your phone each time you sign in.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!!recovery.length ? (
        <>
          <h3>Authenticator enabled</h3>
          <p>
            Save these backup codes somewhere safe. You won’t see them again.
            Each works once if you lose your phone.
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
            I’ve saved my codes
          </Button>
          <p className="muted">
            You’ll sign in again with your authenticator next.
          </p>
        </>
      ) : !status ? (
        <p>Loading security settings…</p>
      ) : !status.available ? (
        <div className="mfa-status-muted">
          <Notice>
            Authenticator setup isn’t ready yet. Please try again later.{" "}
            {status.enabled ? "Your authenticator remains enabled." : ""}
          </Notice>
        </div>
      ) : setup ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget, "activate");
          }}
        >
          {!status.simulated && (
            <>
              <p>
                Add Fairshare to your authenticator app with this key (it
                expires in 10 minutes).
              </p>
              <p>
                <code>{setup.secret}</code>
              </p>
            </>
          )}
          <Field
            label={
              status.simulated
                ? "Any value (simulation)"
                : "Six-digit authenticator code"
            }
          >
            <input
              name="code"
              autoComplete="one-time-code"
              inputMode={status.simulated ? "text" : "numeric"}
              pattern={status.simulated ? undefined : "[0-9]{6}"}
              maxLength={status.simulated ? 80 : 6}
              required
              disabled={busy}
            />
          </Field>
          <Button disabled={busy}>
            {busy
              ? "Verifying…"
              : status.simulated
                ? "Enable simulated step and sign out"
                : "Turn on"}
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
          {status.simulated ? (
            <p>
              Pretend step is on. Turn it off with your password and any code.
            </p>
          ) : (
            <p>
              Enabled · {status.recoveryCodesRemaining} recovery codes
              remaining. Disabling requires your password and an unused code and
              signs out every session.
            </p>
          )}
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
          <Field
            label={
              status.simulated
                ? "Any value (simulation)"
                : "Authenticator or recovery code"
            }
          >
            <input
              name="code"
              autoComplete="one-time-code"
              required
              maxLength={80}
              disabled={busy}
            />
          </Field>
          <Button variant="secondary" disabled={busy}>
            {busy
              ? "Disabling…"
              : status.simulated
                ? "Disable simulated step and sign out"
                : "Turn off"}
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
            {status.simulated
              ? "Off. In test mode this is a pretend step and doesn’t protect your account."
              : "Off."}
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
            {busy
              ? "Preparing…"
              : status.simulated
                ? "Set up simulated step"
                : "Set up authenticator"}
          </Button>
        </form>
      )}
    </section>
  );
}
