"use client";
import { useState } from "react";
import { Button, Field } from "./ui";

export function AgreementName({
  name,
  suggestion,
  busy,
  onSave,
}: {
  name: string;
  suggestion?: string;
  busy: boolean;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(suggestion || name);
  return (
    <details className="section" open={suggestion ? true : undefined}>
      <summary>
        {suggestion ? "Review suggested agreement name" : "Edit agreement name"}
      </summary>
      {suggestion && (
        <p className="muted">
          Suggested from your source document. Review or edit it before saving.
          This does not change the agreement’s terms.
        </p>
      )}
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && value.trim() && value.trim() !== name)
            onSave(value.trim());
        }}
      >
        <Field label="Agreement name">
          <input
            value={value}
            maxLength={200}
            disabled={busy}
            required
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <Button disabled={busy || !value.trim() || value.trim() === name}>
          Save name
        </Button>
      </form>
    </details>
  );
}
