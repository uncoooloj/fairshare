import { useEffect, useRef, useState } from "react";
import { type Agreement, type Version } from "../lib/model";
import { reviewMessage } from "../lib/review-message";
import { Button, Field } from "./ui";

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
          {sent ? "Ready for everyone’s review" : "Ask everyone to review"}
        </h2>
        <Button
          type="button"
          variant="quiet"
          disabled={pending}
          onClick={onClose}
        >
          Close
        </Button>
      </div>
      <p>
        <strong>{agreement.value.name}</strong> · Version {version.id}
      </p>
      <p className="muted">
        {sent
          ? "The proposal is available in Fairshare. Copy a message below to let the other participants know."
          : "Everyone below will review this same version. This does not activate the rules or move money."}
      </p>
      <ul className="send-review-people" aria-label="Review participants">
        {agreement.value.members.map((member) => (
          <li key={member.userId}>
            <span>
              {member.displayName}
              {member.userId === userId ? " (you)" : ""}
            </span>
            <strong>
              {(version.rules.shares.find(
                (share) => share.userId === member.userId,
              )?.basisPoints ?? 0) / 100}
              %
            </strong>
          </li>
        ))}
      </ul>
      {agreement.value.activeVersionId &&
        agreement.value.activeVersionId !== version.id && (
          <p className="muted">
            Version {agreement.value.activeVersionId} continues to govern
            incoming payments until the new version is unanimously approved and
            activated.
          </p>
        )}
      <Field
        label="Personal note to include when you share"
        hint="Optional. Included in the copied message, not sent or saved as a comment."
      >
        <textarea
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setFallback("");
            setCopyState("");
          }}
          placeholder="For example: Please check the fee treatment before approving."
        />
      </Field>
      <p className="muted">
        No email is sent. This message does not grant access; only existing
        agreement participants can review.
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
              window.location.origin,
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
        <div className="row">
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
            {pending
              ? "Preparing review…"
              : `Confirm review of version ${version.id}`}
          </Button>
        </div>
      )}
      {!sent && !canSend && (
        <p role="status">
          This proposal changed or is not ready. Close this window and review
          its current status.
        </p>
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
