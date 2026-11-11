"use client";
import { useRef, useState } from "react";
import { Button } from "./ui";
import { PasswordForm } from "./agreement-widgets";
import { SettingsRow } from "./settings-preferences";

/** Account display name only. Agreement identities and approved rules are unchanged. */
export function ProfileForm({
  name,
  busy,
  onSave,
}: {
  name: string;
  busy: boolean;
  onSave: (name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(name),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  return (
    <form
      className="settings-row-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const value = draft.trim();
        if (
          pending.current ||
          busy ||
          !value ||
          value.length > 80 ||
          value === name
        )
          return;
        pending.current = true;
        setSaving(true);
        setError("");
        try {
          await onSave(value);
        } catch {
          setError("Your name could not be saved. Please try again.");
        } finally {
          pending.current = false;
          setSaving(false);
        }
      }}
    >
      <SettingsRow
        label={<label htmlFor="settings-display-name">Name</label>}
        hint="Agreements keep the name they already have."
      >
        <input
          id="settings-display-name"
          name="name"
          autoComplete="name"
          required
          maxLength={80}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={saving}
        />
        {draft.trim() !== name && (
          <Button disabled={busy || saving || !draft.trim()}>
            {saving ? "Saving…" : "Save name"}
          </Button>
        )}
      </SettingsRow>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

/** Password row: the existing change-password form stays one click away. */
export function PasswordRow({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (currentPassword: string, newPassword: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="settings-row-group">
      <SettingsRow
        label="Password"
        hint="Changing it signs you out everywhere."
      >
        <Button
          type="button"
          variant="secondary"
          aria-expanded={open}
          aria-controls="settings-password-form"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Cancel" : "Change password"}
        </Button>
      </SettingsRow>
      {open && (
        <div id="settings-password-form" className="settings-row-reveal">
          <PasswordForm busy={busy} onSubmit={onSubmit} />
        </div>
      )}
    </div>
  );
}
