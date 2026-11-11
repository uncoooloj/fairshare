"use client";
import { useRef, useState } from "react";
import { Button, Field } from "./ui";

export function AgreementName({
  name,
  suggestion,
  busy,
  onSave,
  defaultOpen = false,
  onClose,
}: {
  name: string;
  suggestion?: string;
  busy: boolean;
  onSave: (name: string) => void;
  /** Opened from the header menu; collapsing it hands control back. */
  defaultOpen?: boolean;
  onClose?: () => void;
}) {
  const [value, setValue] = useState(suggestion || name);
  const input = useRef<HTMLInputElement>(null);
  return (
    <details
      className="section agreement-rename"
      open={suggestion || defaultOpen ? true : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.preventDefault();
        event.stopPropagation();
        // Closing fires onToggle, which hands control back via onClose.
        event.currentTarget.open = false;
      }}
      onToggle={(event) => {
        if (!event.currentTarget.open) onClose?.();
      }}
    >
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
            ref={input}
            autoFocus={defaultOpen}
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
