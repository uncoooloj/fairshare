"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/model";
import { toneForId } from "../lib/person";
import { publicWebOrigin } from "../lib/public-web-origin";
import { Avatar, AvatarSize } from "./person";
import { SettingsPaneHeader } from "./settings-preferences";
import { Button } from "./ui";
import {
  PayoutEmailStep,
  PayoutReadiness,
  PayoutRecipientType,
  PayoutStepResult,
  PAYOUT_ACCOUNT_PATH,
  payoutReadinessLabel,
  type PayoutDestination,
} from "./payout-email-step";
import {
  PayPalConnectButton,
  PayPalConnected,
  paypalFlagMessage,
  takePayPalConnectFlag,
} from "./paypal-connect";

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
  paypalConnect: boolean;
  own: PayoutDestination | null;
  members: { id: string; name: string; status: PayoutReadiness }[];
};
export function PaymentAccountsSettings({
  workspace,
  canEdit = true,
}: {
  workspace: string;
  canEdit?: boolean;
}) {
  const [data, setData] = useState<Accounts | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [changing, setChanging] = useState(false),
    [confirm, setConfirm] = useState(false);
  const pending = useRef(false),
    path = `workspaces/${encodeURIComponent(workspace)}/payment-accounts?version=2`;
  async function load() {
    setData(await api(path));
  }
  useEffect(() => {
    let active = true;
    setData(null);
    setMessage(paypalFlagMessage(takePayPalConnectFlag()));
    if (workspace)
      api(path)
        .then((next) => {
          if (active) setData(next);
        })
        .catch((e) => {
          if (active) setMessage(e.message);
        });
    return () => {
      active = false;
    };
  }, [path, workspace]);
  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await api(PAYOUT_ACCOUNT_PATH, "DELETE");
      await load();
      setConfirm(false);
      setMessage("PayPal email removed.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn’t remove it.");
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
        <p>Upload your first agreement before adding a payout email.</p>
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
            <h3>Getting paid</h3>
            <p className="muted">
              Your share from every agreement is sent to this PayPal email.
            </p>
            <div className="settings-provider">
              <WalletIcon />
              <div>
                <strong>Your PayPal email</strong>
                {data.own?.verified ? (
                  <PayPalConnected
                    email={data.own.value}
                    canEdit={canEdit}
                    onDisconnected={() => {
                      setMessage(
                        "PayPal disconnected. Your share still goes to this email until you change it.",
                      );
                      void load();
                    }}
                  />
                ) : (
                  <span className="muted">
                    {data.own?.type === PayoutRecipientType.EMAIL
                      ? data.own.value
                      : data.own
                        ? "No email yet. Payouts go to the PayPal account you saved earlier until you add one."
                        : "Not set"}
                  </span>
                )}
              </div>
              {canEdit && !changing && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setMessage("");
                    setChanging(true);
                  }}
                >
                  Change
                </Button>
              )}
            </div>
            {data.paypalConnect &&
              canEdit &&
              !changing &&
              !data.own?.verified && <PayPalConnectButton disabled={busy} />}
            {changing && (
              <PayoutEmailStep
                autoFocus={false}
                onDone={(result) => {
                  setChanging(false);
                  if (result === PayoutStepResult.SAVED) {
                    setMessage("PayPal email saved.");
                    void load();
                  }
                }}
              />
            )}
            {data.own && canEdit && !changing && (
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                Remove
              </Button>
            )}
            <p className="muted settings-footnote">
              {canEdit
                ? "Payments already on their way keep the address they were sent to. Test mode: use a PayPal sandbox email."
                : "Viewers can’t change payout details here."}
            </p>
            {confirm && (
              <div role="alert" className="settings-confirm">
                <p>
                  Remove your PayPal email? We can’t send you new payouts until
                  you add one.
                </p>
                <Button disabled={busy} onClick={() => void remove()}>
                  Yes, remove
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  Keep it
                </Button>
              </div>
            )}
          </section>
          <section className="settings-collaborators">
            <h3>Collaborator accounts</h3>
            <p className="muted">
              Everyone needs a PayPal email before their share can be sent.
            </p>
            <div className="settings-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
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
                      <td>
                        <span
                          className={`status-chip ${m.status === PayoutReadiness.READY ? "" : "warning"}`}
                        >
                          {payoutReadinessLabel(m.status)}
                        </span>
                      </td>
                      <td className="settings-cell-action">
                        {m.status === PayoutReadiness.NEEDS_EMAIL && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  `Hi ${m.name}, please open Fairshare, open our agreement, and add your PayPal email under Settings → Payment accounts so your agreed share can be paid. ${publicWebOrigin(location.origin)}/app`,
                                );
                                setMessage(
                                  "Reminder copied. Share it directly with this collaborator. No email was sent.",
                                );
                              } catch {
                                setMessage(
                                  "Couldn’t copy the message. Ask this person to add their PayPal email in Settings → Payment accounts.",
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
