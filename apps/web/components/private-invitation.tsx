import { useRef, useState } from "react";
import { api } from "../lib/model";
import { workspaceBase } from "../lib/workspace-base";
import { Button } from "./ui";

export function PrivateInvitation({ workspace }: { workspace: string }) {
  const [invitation, setInvitation] = useState<{
    id: string;
    token: string;
    expiresAt: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const link = invitation
    ? `${location.origin}/invitation#token=${encodeURIComponent(invitation.token)}`
    : "";
  async function act(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="section">
      <h3>Invite a collaborator</h3>
      <p className="muted">
        Anyone holding this private link can join your team once as a member
        after signing in. Share it only with your intended collaborator. No
        email is sent. The organizer must still add them to an agreement;
        joining does not approve rules or move money.
      </p>
      {!invitation ? (
        <Button
          disabled={busy}
          onClick={() =>
            act(async () => {
              const result = await api(
                `${workspaceBase(workspace)}/invitation-links`,
                "POST",
                { role: "MEMBER" },
              );
              setInvitation(result.invitation);
            })
          }
        >
          Create private invitation link
        </Button>
      ) : (
        <>
          <label>
            Private invitation link
            <input
              readOnly
              aria-label="Private invitation link"
              value={link}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <p className="muted">
            Expires {new Date(invitation.expiresAt).toLocaleString()}. Copy it
            now; it is not stored in your browser.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              act(async () => {
                if (!navigator.clipboard) {
                  setMessage("Select the link above and copy it manually.");
                  return;
                }
                await navigator.clipboard.writeText(link);
                setMessage("Invitation link copied.");
              })
            }
          >
            Copy link
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await api(
                  `${workspaceBase(workspace)}/invitations/${invitation.id}`,
                  "DELETE",
                );
                setInvitation(null);
                setMessage("Invitation revoked. You can create a new one.");
              })
            }
          >
            Revoke link
          </Button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
