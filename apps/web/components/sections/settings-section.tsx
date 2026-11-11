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
import { Heading, SimpleForm } from "../agreement-widgets";
import { MfaSettings } from "../mfa-settings";
import { PasswordRow, ProfileForm } from "../profile-form";
import { PrivateInvitation } from "../private-invitation";
import { api, type Agreement, type User } from "../../lib/model";
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
  agreements: Agreement[];
  inviteLink: string;
  run: Run;
  acceptInvitation: (token: string) => Promise<void>;
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
  agreements,
  inviteLink,
  run,
  acceptInvitation,
  setNotice,
  setInviteLink,
  setUser,
  clearSession,
}: SettingsSectionProps) {
  return (
    <>
      <Heading
        title="Settings"
        description="Your account and test environment."
      />
      <div className="settings-layout">
        <nav className="settings-subnav" aria-label="Settings sections">
          {[
            "Profile",
            "Notifications",
            "Payment accounts",
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
          {settingsTab === "Payment accounts" &&
            (workspace ? (
              <>
                <p className="muted">
                  These payout details apply to{" "}
                  {agreements
                    .filter((item) => item.workspaceId === workspace)
                    .map((item) => item.value.name)
                    .join(", ") || "agreements shared with this team"}
                  . To manage another agreement, open it using the agreement
                  picker above, then return here.
                </p>
                <PaymentAccountsSettings
                  key={workspace}
                  workspace={workspace}
                  canEdit={
                    workspaces.find((w) => w.id === workspace)?.role !==
                    "VIEWER"
                  }
                />
              </>
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
                      setNotice(
                        "Display name saved. Existing agreement names are unchanged.",
                      );
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
                <SettingsRow label="Environment" hint="Live money is disabled.">
                  <span className="status-chip warning">{mode}</span>
                </SettingsRow>
                {inviteLink && (
                  <a className="block-link" href={inviteLink}>
                    Open demo verification/invitation link
                  </a>
                )}
              </section>
              <MfaSettings
                onSignOut={() => {
                  clearSession();
                }}
              />
              <section className="panel">
                <h2>Other invitations</h2>
                {workspaces.find((w) => w.id === workspace)?.role ===
                  "OWNER" && (
                  <PrivateInvitation key={workspace} workspace={workspace} />
                )}
                <SimpleForm
                  label="Invitation token (if shared manually)"
                  button="Accept invitation"
                  busy={busy}
                  onSubmit={(token) =>
                    run(async () => {
                      await acceptInvitation(token);
                    })
                  }
                />
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
