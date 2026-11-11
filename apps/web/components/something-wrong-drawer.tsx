"use client";
import { useEffect, useId, useRef, useState } from "react";
import { formatRuleChange } from "../lib/contract-review";
import { CloseButton } from "./close-button";
import { Button, Notice } from "./ui";

/** The part of the agreement a collaborator says is wrong. */
export enum WrongPart {
  SPLIT = "SPLIT",
  ADVANCE = "ADVANCE",
  FEES = "FEES",
  REFUNDS = "REFUNDS",
  OTHER = "OTHER",
}

export const wrongPartLabels: Record<WrongPart, string> = {
  [WrongPart.SPLIT]: "Split",
  [WrongPart.ADVANCE]: "Advance",
  [WrongPart.FEES]: "Fees",
  [WrongPart.REFUNDS]: "Refunds",
  [WrongPart.OTHER]: "Something else",
};

/**
 * The topic prefix the existing request-change route stores, matching the
 * organizer's "Request a change" topics so both sides read the same labels.
 * "Something else" has no prefix, like "Agreement overall".
 */
export const wrongPartTopics: Record<WrongPart, string> = {
  [WrongPart.SPLIT]: "Revenue split",
  [WrongPart.ADVANCE]: "Advance and recoupment",
  [WrongPart.FEES]: "Fees and net revenue",
  [WrongPart.REFUNDS]: "Refunds",
  [WrongPart.OTHER]: "",
};

/** The reason text sent to the request-change route. Throws a plain error when the note is empty. */
export function changeRequestReason(part: WrongPart, note: string) {
  return formatRuleChange(wrongPartTopics[part], note);
}

/** "Something's not right": pick the part, add a note, send it to the organizer. */
export function SomethingWrongDrawer({
  organizerName,
  busy,
  onSend,
  onClose,
}: {
  organizerName: string;
  busy: boolean;
  onSend: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [part, setPart] = useState<WrongPart>(WrongPart.SPLIT);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const titleId = useId();
  const noteId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    panel.current?.querySelector<HTMLElement>("input:checked")?.focus();
    return () => {
      if (opener.current instanceof HTMLElement && opener.current.isConnected)
        opener.current.focus();
    };
  }, []);
  useEffect(() => {
    if (sent) panel.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [sent]);
  const disabled = busy || sending;
  return (
    <div
      className="collab-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !sending) onClose();
      }}
    >
      <div
        ref={panel}
        className="collab-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !sending) onClose();
          if (event.key !== "Tab") return;
          // Keep keyboard focus inside the drawer while it is open.
          const items = [
            ...(panel.current?.querySelectorAll<HTMLElement>(
              "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex='-1']",
            ) ?? []),
          ].filter((el) => el.tabIndex >= 0);
          if (!items.length) return;
          const first = items[0];
          const last = items[items.length - 1];
          // From the focused heading (not in the list), wrap to the × or the last button.
          if (!items.includes(document.activeElement as HTMLElement)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        {sent ? (
          <div className="collab-drawer-done">
            <div className="collab-drawer-head">
              <span className="collab-check" aria-hidden="true">
                ✓
              </span>
              <CloseButton onClick={onClose} />
            </div>
            <h2 id={titleId} tabIndex={-1}>
              Sent to {organizerName}
            </h2>
            <p>
              {organizerName} will see your note on the{" "}
              {part === WrongPart.OTHER
                ? "agreement"
                : wrongPartLabels[part].toLowerCase()}{" "}
              and can send updated terms. Nothing is paid in the meantime.
            </p>
          </div>
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (disabled) return;
              setError("");
              let reason: string;
              try {
                reason = changeRequestReason(part, note);
              } catch (cause) {
                setError((cause as Error).message);
                return;
              }
              setSending(true);
              try {
                await onSend(reason);
                setSent(true);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Your note wasn’t sent. Try again.",
                );
              } finally {
                setSending(false);
              }
            }}
          >
            <h2 id={titleId}>Request changes</h2>
            <fieldset className="collab-parts">
              <legend className="collab-rule-label">Rule</legend>
              {Object.values(WrongPart).map((value) => (
                <label key={value} className="collab-part">
                  <input
                    type="radio"
                    name="part"
                    value={value}
                    checked={part === value}
                    disabled={disabled}
                    onChange={() => setPart(value)}
                  />
                  <span>{wrongPartLabels[value]}</span>
                </label>
              ))}
            </fieldset>
            <label htmlFor={noteId} className="collab-note-label">
              Comment <span className="muted">(required)</span>
            </label>
            <textarea
              id={noteId}
              required
              rows={5}
              maxLength={1900}
              value={note}
              disabled={disabled}
              onChange={(event) => setNote(event.target.value)}
              placeholder="For example: I agreed to 25%, not 20%."
            />
            <p className="muted collab-hint">
              {organizerName} sees this and can send updated terms. Everyone
              approves again.
            </p>
            {error && (
              <div role="alert">
                <Notice warning>{error}</Notice>
              </div>
            )}
            <div className="collab-drawer-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={sending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={disabled || !note.trim()}>
                {sending ? "Sending…" : "Send request"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
