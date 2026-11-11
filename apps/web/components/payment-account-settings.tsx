"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/model";
import { Button } from "./ui";
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
      <section className="panel">
        <h2>Payment accounts</h2>
        <p>
          Upload your first agreement to create a workspace before adding a
          payout destination.
        </p>
      </section>
    );
  return (
    <section className="panel">
      <h2>Payment accounts</h2>
      <p className="muted">Where money comes in and where shares go out.</p>
      {message && <p role="status">{message}</p>}
      {!data ? (
        <p>Loading payment accounts…</p>
      ) : (
        <>
          <section className="section">
            <h3>Receiving payments</h3>
            <p>PayPal sandbox checkout</p>
            <p className="muted">
              {data.providerConfigured
                ? "PayPal sandbox credentials are configured. Payments are confirmed with PayPal before allocation."
                : "PayPal sandbox credentials are not configured. Checkout is unavailable."}
            </p>
          </section>
          <section className="section">
            <h3>Sending payouts</h3>
            <p className="muted">
              The server’s sandbox merchant account sends agreed shares. These
              are test payments; no real money moves.
            </p>
          </section>
          <section className="section">
            <h3>Your payout destination</h3>
            <p className="muted">
              Save your PayPal sandbox merchant ID for this workspace. This is
              not an OAuth connection or an ownership verification.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label>
                Sandbox merchant ID
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
                {busy ? "Saving…" : "Save payout destination"}
              </Button>
            </form>
            {!canEdit && (
              <p className="muted">
                Viewers cannot change payout destinations.
              </p>
            )}
            {data.ownPaypalId && canEdit && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                Remove payout destination
              </Button>
            )}
            {confirm && (
              <div role="alert">
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
          <section className="section">
            <h3>Collaborator accounts</h3>
            <p className="muted">
              Each person adds their own PayPal account. An account being saved
              doesn’t mean PayPal has verified it.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Account</th>
                    <th>Status</th>
                    <th>Reminder</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{m.accountHint ?? "None"}</td>
                      <td>
                        {m.status === "MISSING"
                          ? "Missing"
                          : "Saved · unverified"}
                      </td>
                      <td>
                        {m.status === "MISSING" && (
                          <Button
                            variant="secondary"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  `Hi ${m.name}, please open Fairshare, select our workspace, and add your sandbox merchant ID under Settings → Payment accounts so your agreed share can be paid. ${location.origin}`,
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
