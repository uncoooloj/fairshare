"use client";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/model";
import { toneForId } from "../lib/person";
import { publicWebOrigin } from "../lib/public-web-origin";
import { ActionMenu } from "./action-menu";
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
/** Confirmation that fades on its own; screen readers hear it once. */
function SavedNote({ text }: { text: string }) {
  return (
    <span className="settings-saved-note" role="status">
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M3 8.5l3 3 7-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {text}
    </span>
  );
}
const SAVED_NOTE_MS = 3000;
type Accounts = {
  // The platform's own PayPal app. Organizers never connect one; invoices are
  // paid through it, so the only state worth showing is when it's missing.
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
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [saved, setSaved] = useState(""),
    [copied, setCopied] = useState(""),
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
    setError("");
    setNote(paypalFlagMessage(takePayPalConnectFlag()));
    if (workspace)
      api(path)
        .then((next) => {
          if (active) setData(next);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [path, workspace]);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(""), SAVED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [saved]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), SAVED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNote("");
    try {
      await api(PAYOUT_ACCOUNT_PATH, "DELETE");
      await load();
      setConfirm(false);
      setSaved("Removed");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn’t remove it.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function copyReminder(name: string) {
    try {
      await navigator.clipboard.writeText(
        `Hi ${name}, please open Fairshare, open our agreement, and add your PayPal email under Settings → PayPal so your agreed share can be paid. ${publicWebOrigin(location.origin)}/app`,
      );
      setCopied(name);
    } catch {
      setNote(
        `Couldn’t copy. Ask ${name} to add their PayPal email in Settings → PayPal.`,
      );
    }
  }
  if (!workspace)
    return (
      <section className="settings-pane">
        <SettingsPaneHeader
          title="PayPal"
          description="Where payments come in and shares go out."
        />
        <p>Upload an agreement first, then add your PayPal email here.</p>
      </section>
    );
  return (
    <section className="settings-pane">
      <SettingsPaneHeader
        title="PayPal"
        description="Where payments come in and shares go out."
      />
      {error && <p role="alert">{error}</p>}
      {!data ? (
        !error && <p role="status">Loading…</p>
      ) : (
        <>
          {!data.providerConfigured && (
            <p className="notice settings-payments-off">
              Payments are off on this server, so invoices can’t be paid yet.
            </p>
          )}
          <section className="settings-card settings-getting-paid">
            <div className="settings-card-head">
              <h3>Getting paid</h3>
              <TestModeChip />
              {saved && <SavedNote key={saved} text={saved} />}
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
                      setNote(
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
                        setNote("");
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
                    setNote("");
                    setSaved("Saved");
                    void load();
                  }
                }}
              />
            ) : (
              <p className="muted settings-footnote">Not set yet.</p>
            )}
            {!canEdit && (
              <p className="muted settings-footnote">
                Viewers can’t change this.
              </p>
            )}
            {note && (
              <p className="muted settings-footnote" role="status">
                {note}
              </p>
            )}
            {confirm && (
              <div role="alert" className="settings-confirm">
                <p>
                  Remove your {payoutLabel}? We can’t send your share until you
                  add one again.
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
            <p className="settings-collaborators-head">
              <strong>Collaborators</strong>
              <span className="muted">
                Each needs a PayPal email to get paid.
              </span>
              {copied && (
                <SavedNote
                  key={copied}
                  text={`Reminder for ${copied} copied`}
                />
              )}
            </p>
            <div className="settings-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
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
                          <ActionMenu
                            label={`Actions for ${m.name}`}
                            items={[
                              {
                                id: "copy-reminder",
                                label: "Copy reminder",
                                onSelect: () => void copyReminder(m.name),
                              },
                            ]}
                          />
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
