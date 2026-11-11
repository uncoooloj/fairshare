"use client";
import { useRef, useState } from "react";
import { Button, Field, Notice } from "./ui";
import { CreationStepper } from "./agreement-creation-wizard";
import { DropZone } from "./drop-zone";

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
  onBusyChange,
}: {
  busy: boolean;
  first?: boolean;
  onCreate: (input: AgreementIntakeInput) => Promise<void>;
  onCancel?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [method, setMethod] = useState<"upload" | "paste">("upload");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
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
    if (busy || locked.current || (method === "upload" ? !file : !text.trim()))
      return;
    locked.current = true;
    setSubmitting(true);
    onBusyChange?.(true);
    setError("");
    try {
      requestId.current ||= crypto.randomUUID();
      const input: AgreementIntakeInput = { requestId: requestId.current };
      if (method === "upload" && file) {
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
      onBusyChange?.(false);
    }
  }
  const disabled = busy || submitting;
  return (
    <div className="creation-wizard">
      <header className="creation-header">
        <h1>New agreement</h1>
      </header>
      <CreationStepper step={0} />
      <form className="creation-body" onSubmit={submit} aria-busy={disabled}>
        <span className="eyebrow">
          {first ? "YOUR FIRST AGREEMENT" : "NEW AGREEMENT"}
        </span>
        <h2>Document</h2>
        <p className="muted">
          Upload a document or paste its text. Then review details, add people
          and check everything before interpreting the rules. You can edit the
          name afterward.
        </p>
        {error && (
          <Notice warning announcement="assertive">
            {error}
          </Notice>
        )}
        <fieldset disabled={disabled} aria-label="Agreement input method">
          <legend>How would you like to add it?</legend>
          <label>
            <input
              type="radio"
              name="inputMethod"
              checked={method === "upload"}
              onChange={() => {
                changed();
                setMethod("upload");
              }}
            />{" "}
            Upload document
          </label>
          <label>
            <input
              type="radio"
              name="inputMethod"
              checked={method === "paste"}
              onChange={() => {
                changed();
                setMethod("paste");
              }}
            />{" "}
            Paste text
          </label>
        </fieldset>
        <div hidden={method !== "upload"}>
          <span className="field-label" id="upload-agreement-label">
            Upload agreement
          </span>
          <DropZone
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            disabled={disabled}
            file={file}
            hint="PDF, DOCX or TXT · up to 5 MB. We’ll read your document when you continue."
            onFile={(next) => {
              changed();
              setFile(next);
            }}
          />
        </div>
        <div hidden={method !== "paste"}>
          <Field label="Paste agreement text">
            <textarea
              rows={9}
              maxLength={40000}
              disabled={disabled || method !== "paste"}
              value={text}
              onChange={(event) => {
                changed();
                setText(event.target.value);
              }}
              placeholder="Paste your agreement here…"
            />
          </Field>
        </div>
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
          <Button
            disabled={disabled || (method === "upload" ? !file : !text.trim())}
          >
            {disabled ? "Reading agreement…" : "Save document & continue"}
          </Button>
        </div>
      </form>
    </div>
  );
}
