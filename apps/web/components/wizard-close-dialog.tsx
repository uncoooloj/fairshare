"use client";
import { useEffect, useRef } from "react";

/**
 * Asked when × is pressed. With a saved draft: Keep as draft or Discard (which deletes it).
 * Before anything is saved: Discard or keep going.
 */
export function WizardCloseDialog({
  saved,
  busy,
  error,
  onKeep,
  onDiscard,
  onCancel,
}: {
  saved: boolean;
  busy: boolean;
  error?: string;
  onKeep(): void;
  onDiscard(): void;
  onCancel(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    if (node && !node.open) node.showModal?.();
    return () => {
      node?.close?.();
      opener?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="wiz-dialog"
      aria-labelledby="wiz-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="wiz-dialog-title">
        {saved ? "Keep this as a draft?" : "Discard this agreement?"}
      </h2>
      <p>
        {saved
          ? "You can finish setting it up later from Agreements."
          : "Nothing has been saved yet."}
      </p>
      {error && (
        <p className="wiz-error" role="alert">
          {error}
        </p>
      )}
      <div className="wiz-dialog-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onDiscard}
        >
          {busy ? "Discarding…" : "Discard"}
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={saved ? onKeep : onCancel}
        >
          {saved ? "Keep as draft" : "Keep going"}
        </button>
      </div>
    </dialog>
  );
}
