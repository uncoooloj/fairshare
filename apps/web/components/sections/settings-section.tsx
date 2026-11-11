import type { Dispatch, SetStateAction } from "react";
import {
  NotificationsSettings,
  CurrencyDisplaySettings,
  SettingsPaneHeader,
  SettingsRow,
} from "../settings-preferences";
import { ProfileContact } from "../profile-contact";
import { PaymentAccountsSettings } from "../payment-account-settings";
import { ActivityLogSettings } from "../activity-log-settings";
import { Heading } from "../agreement-widgets";
import { MfaSettings } from "../mfa-settings";
import { PasswordRow, ProfileForm } from "../profile-form";
import { api, type User } from "../../lib/model";
import { Button, Empty } from "../ui";
import type { Run } from "./types";

export interface SettingsSectionProps {
  user: User;
  mode: string;
  busy: boolean;
  emailDelivery: boolean;
  settingsTab: string;
  setSettingsTab: Dispatch<SetStateAction<string>>;
  workspace: string;
  workspaces: any[];
  inviteLink: string;
  run: Run;
  setNotice: Dispatch<SetStateAction<string>>;
  setInviteLink: Dispatch<SetStateAction<string>>;
  setUser: Dispatch<SetStateAction<User | null>>;
  clearSession: () => void;
}

/** Settings sub-navigation and panes. */
export function SettingsSection({
  user,
  mode,
  busy,
  emailDelivery,
  settingsTab,
  setSettingsTab,
  workspace,
  workspaces,
  inviteLink,
  run,
  setNotice,
  setInviteLink,
  setUser,
  clearSession,
}: SettingsSectionProps) {
  return (
    <>
      <Heading title="Settings" description="Your account." />
      <div className="settings-layout">
        <nav className="settings-subnav" aria-label="Settings sections">
          {[
            "Profile",
            "Notifications",
            "PayPal",
            "Currency & display",
            "Activity log",
          ].map((tab) => (
            <button
              key={tab}
              type="button"
              className="settings-subnav-item"
              aria-current={settingsTab === tab ? "page" : undefined}
              onClick={() => setSettingsTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {settingsTab === "PayPal" &&
            (workspace ? (
              <PaymentAccountsSettings
                key={workspace}
                workspace={workspace}
                canEdit={
                  workspaces.find((w) => w.id === workspace)?.role !== "VIEWER"
                }
              />
            ) : (
              <Empty title="Start an agreement first">
                Upload your first agreement to add a payout email.
              </Empty>
            ))}
          {settingsTab === "Notifications" && (
            <NotificationsSettings key={user.id} />
          )}
          {settingsTab === "Currency & display" && (
            <CurrencyDisplaySettings key={user.id} />
          )}
          {settingsTab === "Activity log" && (
            <ActivityLogSettings
              key={`${user.id}:${workspace}`}
              workspace={workspace}
            />
          )}
          {settingsTab === "Profile" && (
            <>
              <section className="settings-pane">
                <SettingsPaneHeader
                  title="Profile"
                  description="How you appear to the people on your agreements."
                />
                <ProfileContact
                  key={`contact:${user.id}`}
                  userId={user.id}
                  name={user.name}
                  email={user.email}
                  emailVerified={
                    "emailVerified" in user && user.emailVerified === true
                  }
                  emailAction={
                    !("emailVerified" in user && user.emailVerified === true) &&
                    emailDelivery && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const r = await api(
                              "auth/verification/request",
                              "POST",
                              {},
                            );
                            setNotice(
                              r.notice ||
                                "Verification email requested. Check your inbox.",
                            );
                            if (r.demoVerificationLink)
                              setInviteLink(r.demoVerificationLink);
                          })
                        }
                      >
                        Verify email
                      </Button>
                    )
                  }
                >
                  <ProfileForm
                    key={`name:${user.id}`}
                    name={user.name}
                    busy={busy}
                    onSave={async (name) => {
                      const result = await api("auth/profile", "POST", {
                        name,
                      });
                      setUser(result.user);
                      setNotice("Name saved.");
                    }}
                  />
                </ProfileContact>
                <PasswordRow
                  busy={busy}
                  onSubmit={(currentPassword, newPassword) =>
                    run(async () => {
                      await api("auth/password", "POST", {
                        currentPassword,
                        newPassword,
                      });
                      clearSession();
                    })
                  }
                />
                <SettingsRow
                  label="Environment"
                  hint="Test mode. No real money."
                >
                  <span className="status-chip warning">{mode}</span>
                </SettingsRow>
                {inviteLink && (
                  <a className="block-link" href={inviteLink}>
                    Open test link
                  </a>
                )}
              </section>
              <MfaSettings
                onSignOut={() => {
                  clearSession();
                }}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
