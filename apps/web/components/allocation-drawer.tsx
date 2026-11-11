"use client";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { CloseButton } from "./close-button";

/** Modal side sheet on the native dialog: focus trap, Escape and backdrop close come from the platform. */
export function Drawer({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="side-drawer"
      aria-labelledby={heading}
      onCancel={(event) => {
        // Escape: let React own the unmount; a native close event would also fire on effect cleanup.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="side-drawer-body">
        <header className="side-drawer-header">
          <h2 id={heading}>{label}</h2>
          <CloseButton
            onClick={onClose}
            autoFocus
            label={`Close ${label.toLowerCase()}`}
          />
        </header>
        {children}
      </div>
    </dialog>
  );
}
