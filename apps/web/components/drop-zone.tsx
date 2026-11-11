"use client";
import { useId, useRef, useState } from "react";

/**
 * Styled file picker with drag and drop. The native input stays in the tree in every state,
 * so keyboard users, screen readers and the Replace / Try another file buttons all use it.
 */
export function DropZone({
  accept,
  disabled = false,
  file,
  hint,
  prompt = "Drop your signed agreement here or",
  status = "Ready to read",
  error,
  validate,
  onFile,
}: {
  accept: string;
  disabled?: boolean;
  file: File | null;
  hint: string;
  prompt?: string;
  /** Status shown after the size on the selected-file card. */
  status?: string;
  /** A server-side read failure for the chosen file. Shows the unreadable card. */
  error?: string;
  /** Client-side check. A returned message rejects the file without calling onFile. */
  validate?: (file: File) => string | undefined;
  onFile: (file: File | null) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<{
    name: string;
    message: string;
  } | null>(null);

  const choose = (next: File | null) => {
    if (next && validate) {
      const message = validate(next);
      if (message) {
        setRejected({ name: next.name, message });
        return;
      }
    }
    setRejected(null);
    onFile(next);
  };
  const openPicker = () => {
    if (disabled || !input.current) return;
    input.current.value = "";
    input.current.click();
  };

  const failure = rejected
    ? { name: rejected.name, message: rejected.message, unreadable: false }
    : error
      ? { name: file?.name, message: error, unreadable: true }
      : null;
  const empty = !file && !failure;

  return (
    <div
      className={`drop-field${dragging ? " is-dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const dropped = event.dataTransfer.files?.[0];
        if (!disabled && dropped) choose(dropped);
      }}
    >
      <input
        ref={input}
        id={id}
        className="visually-hidden-input"
        type="file"
        accept={accept}
        disabled={disabled}
        tabIndex={empty ? undefined : -1}
        aria-describedby={empty ? `${id}-hint` : undefined}
        onChange={(event) => choose(event.target.files?.[0] || null)}
      />
      {failure ? (
        <div className="file-chip file-card is-error" role="alert">
          <span className="file-card-icon" aria-hidden="true">
            <AlertIcon />
          </span>
          <span className="file-card-body">
            {failure.name && <strong>{failure.name}</strong>}
            <span className="file-card-error">
              {failure.unreadable
                ? "We couldn’t read this file."
                : "This file can’t be used."}{" "}
              {failure.message}
            </span>
            {failure.unreadable && (
              <small>It may be password-protected or a low-quality scan.</small>
            )}
          </span>
          <button
            type="button"
            className="button secondary file-card-action"
            disabled={disabled}
            onClick={openPicker}
          >
            Try another file
          </button>
        </div>
      ) : file ? (
        <div className="file-chip file-card">
          <span className="file-card-icon" aria-hidden="true">
            <DocumentIcon />
          </span>
          <span className="file-card-body">
            <strong title={file.name}>{file.name}</strong>
            <small>
              {formatSize(file.size)} · {status}
            </small>
          </span>
          <button
            type="button"
            className="text-button file-card-action"
            disabled={disabled}
            onClick={openPicker}
          >
            Replace
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Remove file"
            disabled={disabled}
            onClick={() => {
              if (input.current) input.current.value = "";
              choose(null);
            }}
          >
            <CloseIcon />
          </button>
        </div>
      ) : (
        <label
          htmlFor={id}
          className={`drop-zone${dragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
          </svg>
          <span>
            {prompt} <span className="drop-zone-browse">browse</span>
          </span>
          <small id={`${id}-hint`}>{hint}</small>
        </label>
      )}
    </div>
  );
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
