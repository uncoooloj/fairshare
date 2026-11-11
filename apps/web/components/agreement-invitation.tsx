"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/model";
import { Button, Notice } from "./ui";

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
    ? `${location.origin}/invitation#token=${encodeURIComponent(AGREEMENT_INVITE_PREFIX + invitation.token)}`
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
        This private, single-use link adds its holder to this workspace and this
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
            Expires {new Date(invitation.expiresAt).toLocaleString()}. No email
            is sent.
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
  const [preview, setPreview] = useState<{
    agreementName: string;
    inviterName: string;
    expiresAt: number;
  } | null>(null);
  const [error, setError] = useState("");
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
  return (
    <section className="panel" aria-label="Agreement invitation">
      <h2>
        {preview ? `Join ${preview.agreementName}` : "Agreement invitation"}
      </h2>
      {error ? (
        <Notice warning>{error}</Notice>
      ) : preview ? (
        <>
          <p>
            {preview.inviterName} invited you to collaborate on this agreement.
          </p>
          <p>
            Joining as <strong>{email}</strong>.
          </p>
          <p>
            Accepting adds you as a workspace member and agreement collaborator.
            You will review and approve rules separately. No payment is made.
          </p>
          <p className="muted">
            Expires {new Date(preview.expiresAt).toLocaleString()}.
          </p>
          <Button disabled={busy} onClick={onAccept}>
            Accept and open agreement
          </Button>
        </>
      ) : (
        <p role="status">Checking this invitation…</p>
      )}
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        Not now
      </Button>
    </section>
  );
}
