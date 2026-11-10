"use client";
import { useRef, useState } from "react";
import { Button, Field, Notice } from "./ui";

export type AgreementIntakeInput = {
  requestId: string;
  text?: string;
  base64?: string;
  mimeType?: string;
  filename?: string;
  useLocalOcr?: boolean;
};

/** The server saves the workspace, agreement and source together, or none at all. */
export function AgreementIntake({
  busy,
  first = false,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  first?: boolean;
  onCreate: (input: AgreementIntakeInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [ocr, setOcr] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const locked = useRef(false);
  // Retain the key across retry after an uncertain response, but not changed input.
  const requestId = useRef("");
  const changed = () => {
    requestId.current = "";
    setError("");
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || locked.current || (!file && !text.trim())) return;
    locked.current = true;
    setSubmitting(true);
    setError("");
    try {
      requestId.current ||= crypto.randomUUID();
      const input: AgreementIntakeInput = { requestId: requestId.current };
      if (file) {
        if (file.size > 5 * 1024 * 1024)
          throw new Error("Choose a document no larger than 5 MB.");
        input.filename = file.name;
        if (/\.txt$/i.test(file.name) || file.type === "text/plain") {
          input.text = await file.text();
        } else {
          if (!/\.(pdf|docx)$/i.test(file.name))
            throw new Error("Choose a PDF, DOCX or text document.");
          input.mimeType = /\.docx$/i.test(file.name)
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/pdf";
          input.base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = () =>
              reject(
                new Error("Unable to read this file. Please choose it again."),
              );
            reader.readAsDataURL(file);
          });
          input.useLocalOcr = ocr && input.mimeType === "application/pdf";
        }
      } else input.text = text;
      if (
        input.text !== undefined &&
        (!input.text.trim() || input.text.length > 40000)
      )
        throw new Error(
          "Paste between 1 and 40,000 characters of agreement text.",
        );
      await onCreate(input);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save your agreement. Your input is still here; please retry.",
      );
    } finally {
      locked.current = false;
      setSubmitting(false);
    }
  }
  const disabled = busy || submitting;
  return (
    <div className="setup-layout">
      <form className="panel setup-form" onSubmit={submit} aria-busy={disabled}>
        <span className="eyebrow">
          {first ? "YOUR FIRST AGREEMENT" : "NEW AGREEMENT"}
        </span>
        <h2>Start with your agreement</h2>
        <p className="muted">
          Upload a document or paste its text. Review the extracted terms next.
          You can edit the name afterward.
        </p>
        {error && <Notice warning>{error}</Notice>}
        <Field
          label="Upload agreement"
          hint="PDF, DOCX or TXT · up to 5 MB. Use only documents you’re authorized to upload."
        >
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            disabled={disabled}
            onChange={(event) => {
              changed();
              setFile(event.target.files?.[0] || null);
            }}
          />
        </Field>
        {file && (
          <p className="muted">
            Selected: {file.name}. This file will be used instead of pasted
            text.
          </p>
        )}
        {file && /\.pdf$/i.test(file.name) && (
          <label className="check">
            <input
              type="checkbox"
              checked={ocr}
              disabled={disabled}
              onChange={(event) => {
                changed();
                setOcr(event.target.checked);
              }}
            />
            Use local OCR for a scanned PDF (requires server support, English,
            up to 5 pages).
          </label>
        )}
        <Field label="Or paste agreement text">
          <textarea
            rows={9}
            maxLength={40000}
            disabled={disabled || !!file}
            value={text}
            onChange={(event) => {
              changed();
              setText(event.target.value);
            }}
            placeholder="Paste your agreement here…"
          />
        </Field>
        <p className="muted">
          {first
            ? "We’ll create your workspace automatically. No setup form needed. "
            : "Saved in the selected workspace. "}
          Documents stay private on this server. AI interpretation requires your
          confirmation on the next screen.
        </p>
        <div className="setup-footer">
          {onCancel && (
            <Button
              type="button"
              variant="secondary"
              disabled={disabled}
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          <Button disabled={disabled || (!file && !text.trim())}>
            {disabled ? "Reading agreement…" : "Continue with agreement"}
          </Button>
        </div>
      </form>
      <aside className="panel setup-explainer">
        <h3>From agreement to fair payouts</h3>
        <ol>
          <li>
            <strong>Review the source</strong>
            <p>Check the extracted text and suggested name.</p>
          </li>
          <li>
            <strong>Bring everyone in</strong>
            <p>
              Share a link, add the people and review source-linked rules
              together.
            </p>
          </li>
          <li>
            <strong>Approve, then activate</strong>
            <p>
              Everyone approves the same version before the organizer activates
              it.
            </p>
          </li>
        </ol>
        <small>Creating an agreement does not move money.</small>
      </aside>
    </div>
  );
}
