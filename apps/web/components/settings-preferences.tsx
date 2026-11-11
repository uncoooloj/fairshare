"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useEmailDelivery } from "../lib/email-capability";
import { api } from "../lib/model";
import {
  formatDate,
  formatMoney,
  notificationLabels,
  setDisplayPreferences,
  type Preferences,
  type NotificationKind,
} from "../lib/preferences";

/** Settings pane title + one-line description, as in the reference frames. */
export function SettingsPaneHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="settings-pane-head">
      <h2>{title}</h2>
      <p className="muted">{description}</p>
    </header>
  );
}

/** Label-left / control-right settings row separated by a hairline. */
export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <span className="settings-row-title">{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

export function useDisplayPreferences(userId?: string) {
  const [, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    setDisplayPreferences();
    if (userId)
      api<{ preferences: Preferences }>("auth/preferences")
        .then(({ preferences }) => {
          if (active) {
            setDisplayPreferences(preferences);
            refresh((value) => value + 1);
          }
        })
        .catch(() => {
          /* Keep default display if settings cannot be loaded. */
        });
    const update = () => refresh((value) => value + 1);
    window.addEventListener("fairshare-preferences", update);
    return () => {
      active = false;
      setDisplayPreferences();
      window.removeEventListener("fairshare-preferences", update);
    };
  }, [userId]);
}

function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    api<{ preferences: Preferences }>("auth/preferences")
      .then((result) => {
        if (active) setPreferences(result.preferences);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function save() {
    if (!preferences || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ preferences: Preferences }>(
        "auth/preferences",
        "PUT",
        preferences,
      );
      setPreferences(result.preferences);
      setDisplayPreferences(result.preferences);
      window.dispatchEvent(new Event("fairshare-preferences"));
      setNotice("Preferences saved.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save preferences.",
      );
    } finally {
      setSaving(false);
    }
  }
  return { preferences, setPreferences, error, notice, saving, save };
}
function Feedback({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}
export function NotificationsSettings() {
  const emailDelivery = useEmailDelivery();
  const state = usePreferences();
  const { preferences, setPreferences, saving } = state;
  return (
    <section className="settings-pane">
      <SettingsPaneHeader
        title="Notifications"
        description="Choose how Fairshare tells you about things."
      />
      <Feedback error={state.error} notice={state.notice} />
      {!preferences ? (
        <p role="status">Loading preferences…</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void state.save();
          }}
        >
          <div className="settings-table-scroll">
            <table className="settings-toggle-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Notification</span>
                  </th>
                  <th scope="col">In-app</th>
                  {emailDelivery && <th scope="col">Email</th>}
                </tr>
              </thead>
              <tbody>
                {(Object.keys(notificationLabels) as NotificationKind[]).map(
                  (kind) => (
                    <tr key={kind}>
                      <th scope="row">
                        <span className="settings-row-title">
                          {notificationLabels[kind][0]}
                        </span>
                        <span className="settings-row-hint">
                          {notificationLabels[kind][1]}
                        </span>
                      </th>
                      {(["inApp"] as const).map((channel) => (
                        <td key={channel}>
                          <input
                            type="checkbox"
                            role="switch"
                            className="settings-switch"
                            aria-label={notificationLabels[kind][0] + " in-app"}
                            disabled={saving}
                            checked={preferences.notifications[kind][channel]}
                            onChange={(event) =>
                              setPreferences({
                                ...preferences,
                                notifications: {
                                  ...preferences.notifications,
                                  [kind]: {
                                    ...preferences.notifications[kind],
                                    [channel]: event.target.checked,
                                  },
                                },
                              })
                            }
                          />
                        </td>
                      ))}
                      {emailDelivery && (
                        <td>
                          {kind === "approvalRequests" ? (
                            <input
                              type="checkbox"
                              role="switch"
                              className="settings-switch"
                              aria-label="Approval requests email"
                              disabled={saving}
                              checked={
                                preferences.notifications.approvalRequests.email
                              }
                              onChange={(event) =>
                                setPreferences({
                                  ...preferences,
                                  notifications: {
                                    ...preferences.notifications,
                                    approvalRequests: {
                                      ...preferences.notifications
                                        .approvalRequests,
                                      email: event.target.checked,
                                    },
                                  },
                                })
                              }
                            />
                          ) : (
                            <span className="muted">In-app only</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <div className="settings-actions">
            <p className="muted">
              {emailDelivery
                ? "Email is available for approval requests and review reminders only. Other updates are in-app."
                : "In-app only. No email is sent; share links and reminders directly."}
            </p>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
export function CurrencyDisplaySettings() {
  const state = usePreferences();
  const { preferences, setPreferences, saving } = state;
  return (
    <section className="settings-pane">
      <SettingsPaneHeader
        title="Currency & display"
        description="How amounts and dates look across Fairshare."
      />
      <Feedback error={state.error} notice={state.notice} />
      {!preferences ? (
        <p role="status">Loading preferences…</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void state.save();
          }}
        >
          <SettingsRow
            label={<label htmlFor="settings-currency">Default currency</label>}
            hint={
              <span id="currency-help">
                USD only for now. This never converts money.
              </span>
            }
          >
            <select
              id="settings-currency"
              value={preferences.defaultCurrency}
              disabled
              aria-describedby="currency-help"
            >
              <option value="USD">USD – US dollar</option>
            </select>
          </SettingsRow>
          <SettingsRow
            label={<label htmlFor="settings-number">Number format</label>}
            hint={`Preview: ${formatMoney(123456, preferences)}. Amount fields still use a decimal point.`}
          >
            <select
              id="settings-number"
              disabled={saving}
              value={preferences.numberFormat}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  numberFormat: event.target
                    .value as Preferences["numberFormat"],
                })
              }
            >
              <option value="en-US">1,234.56</option>
              <option value="de-DE">1.234,56</option>
              <option value="fr-FR">1 234,56</option>
            </select>
          </SettingsRow>
          <SettingsRow
            label={<label htmlFor="settings-date">Date format</label>}
            hint={`Preview: ${formatDate("2026-11-10T12:00:00Z", preferences)}. Dates use UTC.`}
          >
            <select
              id="settings-date"
              disabled={saving}
              value={preferences.dateFormat}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  dateFormat: event.target.value as Preferences["dateFormat"],
                })
              }
            >
              <option value="medium">Nov 10, 2026</option>
              <option value="day-first">10/11/2026</option>
              <option value="iso">2026-11-10</option>
            </select>
          </SettingsRow>
          <div className="settings-actions">
            <span />
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
