"use client";
import { useEffect, useId, useRef } from "react";
import type { FormEvent, ReactNode } from "react";

/**
 * Right-side sheet for the wizard on the native dialog (a bottom sheet under 600px).
 * Focus trap, Escape and the inert page come from the platform. Mount it to open it and
 * unmount it to close it: there is no `onClose` listener, because React's dev double effect
 * closes the dialog on cleanup and a close listener would then unmount it straight away.
 */
export function WizardDrawer({
  title,
  lede,
  saveLabel = "Save",
  saveDisabled = false,
  hideFooter = false,
  onSave,
  onCancel,
  children,
}: {
  title: string;
  lede?: string;
  saveLabel?: string;
  saveDisabled?: boolean;
  /** Embedded decision steps supply their own explicit apply/cancel controls. */
  hideFooter?: boolean;
  onSave(): void;
  onCancel(): void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!saveDisabled) onSave();
  }
  return (
    <dialog
      ref={dialog}
      className="wd"
      aria-labelledby={heading}
      onCancel={(event) => {
        // Escape: React owns the unmount, so keep the platform from closing it first.
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form className="wd-sheet" onSubmit={submit} noValidate>
        <header className="wd-header">
          <h2 id={heading}>{title}</h2>
          <button
            type="button"
            className="wd-close"
            onClick={onCancel}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3.5 3.5l9 9m0-9l-9 9"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="wd-body">
          {lede ? <p className="wd-lede">{lede}</p> : null}
          {children}
        </div>
        {!hideFooter && (
          <footer className="wd-footer">
            <button
              type="button"
              className="button secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={saveDisabled}
            >
              {saveLabel}
            </button>
          </footer>
        )}
      </form>
    </dialog>
  );
}
