"use client";
import { useEffect, useId, useRef, useState } from "react";
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
  PayoutStepPlace,
  PayoutStepResult,
  PAYOUT_ACCOUNT_PATH,
  payoutReadinessLabel,
  type PayoutDestination,
} from "./payout-email-step";
import {
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
/** Small muted chip; the hint shows on hover, focus or tap. */
function TestModeChip() {
  const tip = useId();
  return (
    <span className="settings-test-chip" tabIndex={0} aria-describedby={tip}>
      Test mode
      <span role="tooltip" id={tip} className="settings-tooltip">
        Use a PayPal sandbox email
      </span>
    </span>
  );
}
type Accounts = {
  providerConfigured: boolean;
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
  const payoutLabel =
    !changing && data?.own?.type === PayoutRecipientType.PAYPAL_ID
      ? "PayPal account"
      : "PayPal email";
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
      setMessage(`${payoutLabel} removed.`);
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
          title="PayPal"
          description="Where payments come in and shares go out."
        />
        <p>Upload your first agreement before adding a payout email.</p>
      </section>
    );
  return (
    <section className="settings-pane">
      <SettingsPaneHeader
        title="PayPal"
        description="Where payments come in and shares go out."
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
                ? "PayPal (test) is connected."
                : "PayPal isn’t connected yet, so you can’t take payments."}
            </p>
            <div className="settings-provider">
              <WalletIcon />
              <div>
                <strong>PayPal</strong>
                <span className="muted">Test payments only</span>
              </div>
              <span
                className={`status-chip ${data.providerConfigured ? "good" : "warning"}`}
              >
                {data.providerConfigured ? "Configured" : "Not configured"}
              </span>
            </div>
          </section>
          <section className="settings-card settings-getting-paid">
            <div className="settings-card-head">
              <h3>Getting paid</h3>
              <TestModeChip />
            </div>
            <p className="muted">
              {!changing && data.own?.type === PayoutRecipientType.PAYPAL_ID
                ? "Your share from every agreement goes to this PayPal account."
                : "Your share from every agreement goes to this PayPal email."}
            </p>
            {data.own && !changing ? (
              <div className="settings-payout-saved">
                {data.own.verified ? (
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
                  <strong className="settings-payout-email">
                    {data.own.type === PayoutRecipientType.EMAIL
                      ? data.own.value
                      : `PayPal account ending ${data.own.value.slice(-4)}`}
                  </strong>
                )}
                {canEdit && (
                  <span className="settings-payout-links">
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={busy}
                      onClick={() => {
                        setMessage("");
                        setConfirm(false);
                        setChanging(true);
                      }}
                    >
                      Change
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={busy}
                      onClick={() => setConfirm(true)}
                    >
                      Remove
                    </Button>
                  </span>
                )}
              </div>
            ) : canEdit ? (
              <PayoutEmailStep
                autoFocus={false}
                place={PayoutStepPlace.SETTINGS}
                onCancel={data.own ? () => setChanging(false) : undefined}
                onDone={(result) => {
                  setChanging(false);
                  if (result === PayoutStepResult.SAVED) {
                    setMessage("PayPal email saved.");
                    void load();
                  }
                }}
              />
            ) : (
              <p className="muted settings-footnote">Not set yet.</p>
            )}
            {!canEdit && (
              <p className="muted settings-footnote">
                Viewers can’t change payout details here.
              </p>
            )}
            {confirm && (
              <div role="alert" className="settings-confirm">
                <p>
                  Remove your {payoutLabel}? We can’t send you new payouts until
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
                                  `Hi ${m.name}, please open Fairshare, open our agreement, and add your PayPal email under Settings → PayPal so your agreed share can be paid. ${publicWebOrigin(location.origin)}/app`,
                                );
                                setMessage(
                                  "Reminder copied. Share it directly with this collaborator. No email was sent.",
                                );
                              } catch {
                                setMessage(
                                  "Couldn’t copy the message. Ask this person to add their PayPal email in Settings → PayPal.",
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
