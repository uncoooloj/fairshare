"use client";
import { useRef, useState } from "react";

/** Styled file picker with drag and drop. The native input stays in the tree for keyboard and screen readers. */
export function DropZone({
  accept,
  disabled = false,
  file,
  hint,
  prompt = "Drop your signed agreement here or",
  onFile,
}: {
  accept: string;
  disabled?: boolean;
  file: File | null;
  hint: string;
  prompt?: string;
  onFile: (file: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  if (file)
    return (
      <div className="file-chip">
        <span className="file-chip-icon" aria-hidden="true">
          {file.name.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE"}
        </span>
        <span className="file-chip-name">
          <strong>{file.name}</strong>
          <small>{formatSize(file.size)} · ready to read</small>
        </span>
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => {
            if (input.current) input.current.value = "";
            onFile(null);
          }}
        >
          Replace
        </button>
      </div>
    );
  return (
    <label
      className={`drop-zone${dragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const dropped = event.dataTransfer.files?.[0];
        if (!disabled && dropped) onFile(dropped);
      }}
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
      <small>{hint}</small>
      <input
        ref={input}
        className="visually-hidden-input"
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => onFile(event.target.files?.[0] || null)}
      />
    </label>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
