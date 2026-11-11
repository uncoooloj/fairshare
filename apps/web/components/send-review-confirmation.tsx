import { useEffect, useRef, useState } from "react";
import { type Agreement, type Version } from "../lib/model";
import { reviewMessage } from "../lib/review-message";
import { publicWebOrigin } from "../lib/public-web-origin";
import { CloseButton } from "./close-button";
import { Button, Field } from "./ui";

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function SendReviewConfirmation({
  agreement,
  version,
  userId,
  busy,
  canSend,
  requestError,
  onSend,
  onClose,
}: {
  agreement: Agreement;
  version: Version;
  userId: string;
  busy: boolean;
  canSend: boolean;
  requestError: string;
  onSend: () => Promise<boolean>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState("");
  const [fallback, setFallback] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      opener?.focus();
    };
  }, []);
  const pending = busy || posting;
  return (
    <dialog
      ref={dialog}
      className="send-review-dialog"
      aria-labelledby="send-review-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <div className="send-review-header">
        <h2 id="send-review-title">
          {sent
            ? "Ready for everyone’s review"
            : `Send v${version.id} for approval`}
        </h2>
        <CloseButton disabled={pending} onClick={onClose} />
      </div>
      <p className="send-review-binding">
        <strong>{agreement.value.name}</strong>
        <span>Version {version.id}</span>
      </p>
      <p className="send-review-intro">
        {sent
          ? "The proposal is available in Fairshare. Copy a message below to let the other participants know."
          : "They’ll be asked to approve this exact version."}
      </p>
      <ul className="send-review-people" aria-label="Review participants">
        {agreement.value.members
          .filter((member) => member.userId !== userId)
          .map((member) => (
            <li key={member.userId}>
              <span className="send-review-person-avatar" aria-hidden="true">
                {initials(member.displayName)}
              </span>
              <span className="send-review-person-name">
                {member.displayName}
              </span>
            </li>
          ))}
      </ul>
      {agreement.value.activeVersionId &&
        agreement.value.activeVersionId !== version.id && (
          <p className="muted">
            Version {agreement.value.activeVersionId} stays in use until
            everyone approves this one.
          </p>
        )}
      <Field label="Message" hint="Optional. Added to the message you copy.">
        <textarea
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setFallback("");
            setCopyState("");
          }}
          placeholder="Add a note for the other participants"
        />
      </Field>
      <p className="send-review-note">
        The rules become binding when everyone approves this exact version. We
        don’t send email; copy the message after sending and share it yourself.
      </p>
      {(requestError || error) && <p role="alert">{requestError || error}</p>}
      {sent ? (
        <Button
          type="button"
          onClick={async () => {
            const text = reviewMessage(
              agreement.value.name,
              version.id,
              note,
              publicWebOrigin(window.location.origin),
            );
            try {
              await navigator.clipboard.writeText(text);
              setCopyState("Review message copied.");
              setFallback("");
            } catch {
              setFallback(text);
              setCopyState("Copy the message below.");
            }
          }}
        >
          Copy review message
        </Button>
      ) : (
        <div className="send-review-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || !canSend}
            onClick={async () => {
              if (lock.current || !canSend) return;
              lock.current = true;
              setPosting(true);
              setError("");
              try {
                if (await onSend()) setSent(true);
                else
                  setError(
                    "The review request wasn’t confirmed. Check the latest agreement and try again.",
                  );
              } finally {
                lock.current = false;
                setPosting(false);
              }
            }}
          >
            {pending ? "Preparing review…" : "Send"}
          </Button>
        </div>
      )}
      {!sent && !canSend && (
        <p role="status">Something changed. Close this and check the latest.</p>
      )}
      {copyState && <p role="status">{copyState}</p>}
      {fallback && (
        <textarea
          aria-label="Review message to copy"
          readOnly
          rows={6}
          value={fallback}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </dialog>
  );
}
