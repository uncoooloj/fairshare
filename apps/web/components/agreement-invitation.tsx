"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { api } from "../lib/model";
import { publicWebOrigin } from "../lib/public-web-origin";
import { Button, Notice } from "./ui";
import { formatExact } from "../lib/dates";
import { LogoMark } from "./logo-mark";
import { Avatar } from "./person";

export const AGREEMENT_INVITE_PREFIX = "agreement:";
export function AgreementInvitation({
  base,
  name,
}: {
  base: string;
  name: string;
}) {
  const [invitation, setInvitation] = useState<{
    id: string;
    token: string;
    expiresAt: number;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const pending = useRef(false);
  const link = invitation
    ? `${publicWebOrigin(location.origin)}/invitation#token=${encodeURIComponent(AGREEMENT_INVITE_PREFIX + invitation.token)}`
    : "";
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not update invitation.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="section">
      <h3>Invite someone to {name}</h3>
      <p className="muted">
        Send this link to one person. It works once and adds them to this
        agreement.
      </p>
      {!invitation ? (
        <Button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await api(`${base}/invitation-links`, "POST", {});
              setInvitation(result.invitation);
            })
          }
        >
          Create invite link
        </Button>
      ) : (
        <>
          <label>
            Invite link
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
          </label>
          <p className="muted">
            Expires {formatExact(invitation.expiresAt)}. No email is sent.
          </p>
          <div className="actions">
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!navigator.clipboard) {
                    setMessage("Select and copy the link above.");
                    return;
                  }
                  await navigator.clipboard.writeText(link);
                  setMessage("Link copied.");
                })
              }
            >
              Copy link
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(
                    `${base}/invitation-links/${invitation.id}`,
                    "DELETE",
                  );
                  setInvitation(null);
                  setMessage("Invitation revoked.");
                })
              }
            >
              Revoke link
            </Button>
          </div>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

/** Brand mark for the standalone invite pages. */
function InviteBrand() {
  return (
    <div className="collab-invite-brand">
      <LogoMark />
      Fairshare
    </div>
  );
}

/** What the token-only preview returns. Nothing about amounts, people or rules. */
export type InvitePreview = {
  agreementName: string;
  inviterName: string;
  expiresAt: number;
  alreadyAccepted?: boolean;
};

/** The agreement-invite token in `#token=agreement:…` (or `#agreement:…`), without the prefix. */
export function agreementInviteTokenFromHash(hash: string): string | null {
  const raw = hash.replace(/^#/, "").replace(/^token=/, "");
  let token: string;
  try {
    token = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return token.startsWith(AGREEMENT_INVITE_PREFIX)
    ? token.slice(AGREEMENT_INVITE_PREFIX.length)
    : null;
}

export function InvitationSignInCopy({
  preview,
}: {
  preview: InvitePreview | null;
}) {
  return (
    <aside className="collab-signin-context" aria-label="Your invitation">
      <strong>
        {preview
          ? `${preview.inviterName} invited you to ${preview.agreementName}`
          : "You’ve been invited to review an agreement."}
      </strong>
      <span>
        Sign in or create an account to review it. We’ll bring you straight back
        here.
      </span>
    </aside>
  );
}

/**
 * Shown above sign-in when someone opens an agreement invite while signed out.
 * The preview is token-only, so it names the inviter and agreement before
 * sign-in. The link stays in the URL fragment (never sent to the server) so the
 * full invite opens after sign-in.
 */
export function InvitationSignInContext({ token }: { token?: string }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  useEffect(() => {
    const current = token ?? agreementInviteTokenFromHash(location.hash);
    if (!current) return;
    let live = true;
    api<InvitePreview>("agreement-invitations/preview", "POST", {
      token: current,
    })
      .then((r) => {
        if (live) setPreview(r);
      })
      // An invalid or expired link is explained after sign-in; keep sign-in usable.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [token]);
  return <InvitationSignInCopy preview={preview} />;
}

/** The invite landing: accepting joins the agreement; approval happens in review. */
export function AgreementInvitationPreview({
  token,
  email,
  busy,
  error: actionError = "",
  onAccept,
  onCancel,
}: {
  token: string;
  email: string;
  busy: boolean;
  error?: string;
  onAccept: () => Promise<void>;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const pending = useRef(false);
  const disabled = busy || accepting;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let live = true;
    setPreview(null);
    setError("");
    api("agreement-invitations/preview", "POST", { token })
      .then((r) => {
        if (live) setPreview(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [token, attempt]);
  useEffect(() => {
    heading.current?.focus();
  }, [preview, error]);
  async function accept() {
    if (pending.current || busy) return;
    pending.current = true;
    setAccepting(true);
    try {
      await onAccept();
    } finally {
      pending.current = false;
      setAccepting(false);
    }
  }
  return (
    <InvitationCard
      preview={preview}
      error={error}
      actionError={actionError}
      disabled={disabled}
      heading={heading}
      email={email}
      onAccept={() => void accept()}
      onCancel={onCancel}
      onRetry={() => setAttempt((current) => current + 1)}
    />
  );
}

/** Keep acceptance errors inside the visible standalone card, not under its overlay. */
export function InvitationCard({
  preview,
  error = "",
  actionError = "",
  disabled,
  heading,
  email,
  onAccept,
  onCancel,
  onRetry,
}: {
  preview: InvitePreview | null;
  error?: string;
  actionError?: string;
  disabled: boolean;
  heading?: RefObject<HTMLHeadingElement | null>;
  email: string;
  onAccept: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="collab-invite-page">
      <InviteBrand />
      <section className="collab-invite-card" aria-labelledby="invite-title">
        {error ? (
          <>
            <h1 id="invite-title" ref={heading} tabIndex={-1}>
              This invite can’t be opened
            </h1>
            <Notice warning>{error}</Notice>
            <p className="muted">
              Ask the person who invited you to send a new link.
            </p>
            <Button variant="secondary" disabled={disabled} onClick={onRetry}>
              Try again
            </Button>
          </>
        ) : preview ? (
          <>
            <div className="collab-invite-sender">
              <Avatar name={preview.inviterName} tone={0} label={false} />
              <p>
                <strong>{preview.inviterName}</strong> invited you to an
                agreement
              </p>
            </div>
            <p className="collab-invite-lede">
              {preview.alreadyAccepted
                ? "You’ve already joined. Open the agreement to continue your review."
                : `${firstName(preview.inviterName)}’s asking you to review how the money is split.`}
            </p>
            <h1 id="invite-title" ref={heading} tabIndex={-1}>
              {preview.agreementName}
            </h1>
            {actionError && (
              <div role="alert">
                <Notice warning>{actionError}</Notice>
              </div>
            )}
            <div className="collab-invite-actions">
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={onCancel}
              >
                Not now
              </Button>
              <Button
                className="collab-invite-primary"
                disabled={disabled}
                onClick={onAccept}
              >
                {disabled
                  ? "Opening…"
                  : preview.alreadyAccepted
                    ? "Open agreement"
                    : "Accept"}
              </Button>
            </div>
            <p className="collab-invite-safe">
              Accepting this invitation doesn’t approve the terms.
            </p>
            <p className="collab-invite-meta muted">
              {preview.alreadyAccepted ? "Signed in" : "Joining"} as{" "}
              <strong>{email}</strong>.{" Access is limited to this agreement."}
              {!preview.alreadyAccepted &&
                ` Link expires ${formatExact(preview.expiresAt)}.`}
            </p>
          </>
        ) : (
          <p role="status">Opening your invite…</p>
        )}
        {!preview && (
          <Button
            variant="quiet"
            className="collab-invite-later"
            disabled={disabled}
            onClick={onCancel}
          >
            Not now
          </Button>
        )}
      </section>
    </div>
  );
}
