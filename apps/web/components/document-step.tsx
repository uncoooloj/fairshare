"use client";
import { useId } from "react";
import { DropZone } from "./drop-zone";

export enum DocumentMode {
  UPLOAD = "upload",
  PASTE = "paste",
}

/** Server limit: apps/api/src/pdf.ts MAX_PDF_BYTES and apps/api/src/docx.ts MAX_DOCX_BYTES. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
/** Server limit for agreement text (apps/api/src/agreementIntake.ts). TXT files are sent as text. */
export const MAX_DOCUMENT_TEXT_LENGTH = 40000;
export const DOCUMENT_ACCEPT =
  ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
export const DOCUMENT_HINT = "PDF, Word or text, up to 5 MB";

const ACCEPTED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

/** Rejects files the server can't take, before anything is uploaded. */
export function validateDocumentFile(file: File): string | undefined {
  const extension = /\.(pdf|docx|txt)$/i.test(file.name);
  if (!extension && !ACCEPTED_TYPES.has(file.type))
    return "Choose a PDF, Word or text file.";
  if (file.size === 0) return "This file is empty. Choose another document.";
  if (file.size > MAX_DOCUMENT_BYTES)
    return "Choose a document no larger than 5 MB.";
  return undefined;
}

export function DocumentStep({
  file,
  text,
  mode,
  error,
  disabled = false,
  onFile,
  onText,
  onMode,
}: {
  file: File | null;
  text: string;
  mode: DocumentMode;
  error?: string;
  disabled?: boolean;
  onFile(file: File | null): void;
  onText(text: string): void;
  onMode(mode: DocumentMode): void;
}) {
  const textId = useId();
  if (mode === DocumentMode.PASTE)
    return (
      <div className="document-step">
        <label className="field-label" htmlFor={textId}>
          Agreement text
        </label>
        <textarea
          id={textId}
          className="document-step-text"
          rows={12}
          maxLength={MAX_DOCUMENT_TEXT_LENGTH}
          disabled={disabled}
          value={text}
          onChange={(event) => onText(event.target.value)}
          placeholder="Paste your agreement here…"
          aria-describedby={`${textId}-count`}
        />
        <div className="document-step-meta">
          <small id={`${textId}-count`}>
            {text.length.toLocaleString("en-US")} /{" "}
            {MAX_DOCUMENT_TEXT_LENGTH.toLocaleString("en-US")} characters
          </small>
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={() => onMode(DocumentMode.UPLOAD)}
          >
            Upload a file instead
          </button>
        </div>
      </div>
    );
  return (
    <div className="document-step">
      <DropZone
        accept={DOCUMENT_ACCEPT}
        disabled={disabled}
        file={file}
        hint={DOCUMENT_HINT}
        error={error}
        validate={validateDocumentFile}
        onFile={onFile}
      />
      <div className="document-step-meta">
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => onMode(DocumentMode.PASTE)}
        >
          Paste the text instead
        </button>
      </div>
    </div>
  );
}
