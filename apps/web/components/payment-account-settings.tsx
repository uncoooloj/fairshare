"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/model";
import { toneForId } from "../lib/person";
import { publicWebOrigin } from "../lib/public-web-origin";
import { Avatar, AvatarSize } from "./person";
import { SettingsPaneHeader } from "./settings-preferences";
import { Button } from "./ui";

function WalletIcon() {
  return (
    <span className="settings-provider-icon" aria-hidden="true">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 7h15v12H4zM4 7V5h12M14 12h5v3h-5z" />
      </svg>
    </span>
  );
}
type Accounts = {
  providerConfigured: boolean;
  ownPaypalId: string | null;
  members: {
    id: string;
    name: string;
    status: string;
    accountHint: string | null;
  }[];
};
export function PaymentAccountsSettings({
  workspace,
  canEdit = true,
}: {
  workspace: string;
  canEdit?: boolean;
}) {
  const [data, setData] = useState<Accounts | null>(null),
    [paypalId, setPaypalId] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const pending = useRef(false),
    path = `workspaces/${encodeURIComponent(workspace)}/payment-accounts`;
  async function load() {
    const next = await api(path);
    setData(next);
    setPaypalId(next.ownPaypalId ?? "");
  }
  useEffect(() => {
    let active = true;
    setData(null);
    setMessage("");
    if (workspace)
      api(path)
        .then((next) => {
          if (active) {
            setData(next);
            setPaypalId(next.ownPaypalId ?? "");
          }
        })
        .catch((e) => {
          if (active) setMessage(e.message);
        });
    return () => {
      active = false;
    };
  }, [path, workspace]);
  async function save(remove = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await api(
        `${path}/mine`,
        remove ? "DELETE" : "PUT",
        remove ? undefined : { paypalId },
      );
      await load();
      setConfirm(false);
      setMessage(
        remove
          ? "Payout destination removed. Previously submitted payouts are unchanged."
          : "Payout destination saved. PayPal has not verified account ownership.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save account.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (!workspace)
    return (
      <section className="settings-pane">
        <SettingsPaneHeader
          title="Payment accounts"
          description="Where money comes in and where shares go out."
        />
        <p>Upload your first agreement before adding a payout destination.</p>
      </section>
    );
  return (
    <section className="settings-pane">
      <SettingsPaneHeader
        title="Payment accounts"
        description="Where money comes in and where shares go out."
      />
      {message && <p role="status">{message}</p>}
      {!data ? (
        <p role="status">Loading payment accounts…</p>
      ) : (
        <>
          <section className="settings-card">
            <h3>Receiving payments</h3>
            <p className="muted">
              {data.providerConfigured
                ? "PayPal sandbox credentials are configured. Received payments follow your active agreement rules."
                : "PayPal sandbox credentials are not configured. Payments can’t be received until setup is complete."}
            </p>
            <div className="settings-provider">
              <WalletIcon />
              <div>
                <strong>PayPal</strong>
                <span className="muted">
                  Sandbox checkout · test money only
                </span>
              </div>
              <span
                className={`status-chip ${data.providerConfigured ? "good" : "warning"}`}
              >
                {data.providerConfigured ? "Configured" : "Not configured"}
              </span>
            </div>
          </section>
          <section className="settings-card">
            <h3>Sending payouts</h3>
            <p className="muted">
              Save where your agreed share should be sent in the sandbox. Saving
              a destination does not establish that server payout sending is
              available or schedule a payout.
            </p>
            <div className="settings-provider">
              <WalletIcon />
              <div>
                <strong>PayPal payouts</strong>
                <span className="muted">
                  {data.ownPaypalId
                    ? `Your destination · ${data.ownPaypalId}`
                    : "No payout destination saved for you yet"}
                </span>
              </div>
              <span
                className={`status-chip ${data.ownPaypalId ? "" : "warning"}`}
              >
                {data.ownPaypalId ? "Saved · unverified" : "Missing"}
              </span>
            </div>
            <p className="muted">
              This destination applies to the selected agreement and other
              agreements with the same team. Saving it does not verify account
              ownership.
            </p>
            <form
              className="settings-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label>
                <span>Sandbox merchant ID</span>
                <input
                  value={paypalId}
                  onChange={(e) =>
                    setPaypalId(e.target.value.toUpperCase().trim())
                  }
                  maxLength={13}
                  pattern="[A-Z0-9]{13}"
                  required
                  autoComplete="off"
                  disabled={!canEdit || busy}
                />
              </label>
              <Button disabled={!canEdit || busy} type="submit">
                {busy ? "Saving…" : "Save destination"}
              </Button>
              {data.ownPaypalId && canEdit && (
                <Button
                  type="button"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setConfirm(true)}
                >
                  Remove
                </Button>
              )}
            </form>
            <p className="muted settings-footnote">
              {canEdit
                ? "Saving an ID is not an OAuth connection or ownership check."
                : "Viewers cannot change payout destinations."}
            </p>
            {confirm && (
              <div role="alert" className="settings-confirm">
                <p>
                  Remove your saved destination? Future payouts to you need a
                  destination added again. Already submitted payouts cannot be
                  canceled here.
                </p>
                <Button disabled={busy} onClick={() => void save(true)}>
                  Yes, remove
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  Keep account
                </Button>
              </div>
            )}
          </section>
          <section className="settings-collaborators">
            <h3>Collaborator accounts</h3>
            <p className="muted">
              People need an account before their payouts can go out. Saved
              doesn’t mean PayPal verified it.
            </p>
            <div className="settings-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Account</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="visually-hidden">Reminder</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <span className="settings-person">
                          <Avatar
                            name={m.name}
                            tone={toneForId(m.id)}
                            size={AvatarSize.SMALL}
                            label={false}
                          />
                          {m.name}
                        </span>
                      </td>
                      <td className={m.accountHint ? "" : "muted"}>
                        {m.accountHint ? `PayPal · ${m.accountHint}` : "None"}
                      </td>
                      <td>
                        <span
                          className={`status-chip ${m.status === "MISSING" ? "warning" : ""}`}
                        >
                          {m.status === "MISSING"
                            ? "Missing"
                            : "Saved · unverified"}
                        </span>
                      </td>
                      <td className="settings-cell-action">
                        {m.status === "MISSING" && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  `Hi ${m.name}, please open Fairshare, open our agreement, and add your sandbox merchant ID under Settings → Payment accounts so your agreed share can be paid. ${publicWebOrigin(location.origin)}/app`,
                                );
                                setMessage(
                                  "Reminder copied. Share it directly with this collaborator. No email was sent.",
                                );
                              } catch {
                                setMessage(
                                  "Couldn’t copy the message. Ask this person to add their PayPal account in Settings → Payment accounts.",
                                );
                              }
                            }}
                          >
                            Copy reminder
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
