"use client";
import { useRef, useState } from "react";
import { Button, Field } from "./ui";

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
      className="inline-form"
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
      <Field
        label="Display name"
        hint="Updates your account only, not names recorded in existing agreements."
      >
        <input
          name="name"
          autoComplete="name"
          required
          maxLength={80}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={saving}
        />
      </Field>
      <Button
        disabled={busy || saving || !draft.trim() || draft.trim() === name}
      >
        {saving ? "Saving…" : "Save name"}
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
