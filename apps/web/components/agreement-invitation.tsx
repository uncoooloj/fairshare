"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/model";
import { publicWebOrigin } from "../lib/public-web-origin";
import { Button, Notice } from "./ui";
import { formatExact } from "../lib/dates";
import { LogoMark } from "./logo-mark";

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
        This private, single-use link adds its holder to your team and this
        agreement after sign-in and acceptance. Share only with your intended
        collaborator. Wait for everyone to join before drafting rules; joining
        never approves rules or moves money.
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
          Create agreement invitation
        </Button>
      ) : (
        <>
          <label>
            Private agreement invitation
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
                  setMessage("Agreement invitation copied.");
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

/** The invite landing: who invited you, to what, and one button to review it. */
export function AgreementInvitationPreview({
  token,
  email,
  busy,
  onAccept,
  onCancel,
}: {
  token: string;
  email: string;
  busy: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState("");
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
  }, [token]);
  useEffect(() => {
    heading.current?.focus();
  }, [preview, error]);
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
          </>
        ) : preview ? (
          <>
            <h1 id="invite-title" ref={heading} tabIndex={-1}>
              {preview.inviterName} invited you to {preview.agreementName}
            </h1>
            <p className="collab-invite-lede">
              {firstName(preview.inviterName)}’s asking you to approve how its
              money is split.
            </p>
            <Button
              className="collab-invite-primary"
              disabled={busy}
              onClick={onAccept}
            >
              {busy ? "Opening…" : "Review"}
            </Button>
            <p className="collab-invite-safe">
              Nothing is paid until everyone approves.
            </p>
            <p className="collab-invite-meta muted">
              Joining as <strong>{email}</strong>, as a collaborator on this
              agreement only. {"It does not grant access to other agreements."}{" "}
              Link expires {formatExact(preview.expiresAt)}.
            </p>
          </>
        ) : (
          <p role="status">Opening your invite…</p>
        )}
        <Button
          variant="quiet"
          className="collab-invite-later"
          disabled={busy}
          onClick={onCancel}
        >
          Not now
        </Button>
      </section>
    </div>
  );
}
