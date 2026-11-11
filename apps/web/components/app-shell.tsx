import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Avatar } from "./person";
import { toneForId } from "../lib/person";
import { NotificationPanel } from "./notification-panel";
import { Logo } from "./agreement-widgets";
import { Section, api, title, type Agreement, type User } from "../lib/model";
import { Button, Icon } from "./ui";
import type { Run } from "./sections/types";

export interface AppShellProps {
  user: User;
  mode: string;
  section: Section;
  agreements: Agreement[];
  selected: Agreement | null;
  busy: boolean;
  error: string;
  notice: string;
  run: Run;
  refresh: () => Promise<void>;
  navigate: (s: Section) => boolean;
  mayLeaveDraft: () => boolean;
  openAgreement: (a: Agreement) => Promise<void>;
  setSettingsTab: Dispatch<SetStateAction<string>>;
  setUser: Dispatch<SetStateAction<User | null>>;
  setWorkspace: Dispatch<SetStateAction<string>>;
  setSelected: Dispatch<SetStateAction<Agreement | null>>;
  setAgreements: Dispatch<SetStateAction<Agreement[]>>;
  children: ReactNode;
}

/** Sidebar, agreement bar and status banners around the active section. */
export function AppShell({
  user,
  mode,
  section,
  agreements,
  selected,
  busy,
  error,
  notice,
  run,
  refresh,
  navigate,
  mayLeaveDraft,
  openAgreement,
  setSettingsTab,
  setUser,
  setWorkspace,
  setSelected,
  setAgreements,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar">
        <Logo />
        <nav aria-label="Main navigation">
          {Object.values(Section).map((s) => (
            <button
              key={s}
              aria-current={section === s ? "page" : undefined}
              className={section === s ? "nav-item selected" : "nav-item"}
              onClick={() => navigate(s)}
            >
              <Icon name={s} />
              {s}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="environment">
            <span className="environment-dot" aria-hidden="true" />
            {title(mode)} · no live money
          </span>
          <div className="identity">
            <Avatar name={user.name} tone={toneForId(user.id)} />
            <div>
              <strong>{user.name}</strong>
              <small title={user.email}>{user.email}</small>
            </div>
          </div>
          <button
            className="text-button sign-out"
            onClick={() => {
              if (!mayLeaveDraft()) return;
              return run(async () => {
                await api("auth/logout", "POST", {});
                setUser(null);
                setWorkspace("");
                setSelected(null);
                setAgreements([]);
              });
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main" id="main-content" tabIndex={-1}>
        <div className="workspace-bar">
          <span>Agreement</span>
          {agreements.length ? (
            <select
              aria-label="Open agreement"
              value={selected?.id ?? ""}
              disabled={busy}
              onChange={(e) => {
                const agreement = agreements.find(
                  (item) => item.id === e.target.value,
                );
                if (!agreement || !mayLeaveDraft()) return;
                void run(() => openAgreement(agreement));
              }}
            >
              <option value="" disabled>
                Choose an agreement
              </option>
              {agreements.map((agreement) => (
                <option key={agreement.id} value={agreement.id}>
                  {agreement.value.name}
                </option>
              ))}
            </select>
          ) : (
            <strong>Your agreements</strong>
          )}
          <span className="spacer" />
          <NotificationPanel
            key={user.id}
            agreementIds={agreements.map((agreement) => agreement.id)}
            onOpenAgreement={(id) => {
              const agreement = agreements.find((item) => item.id === id);
              if (!agreement || !mayLeaveDraft()) return false;
              void run(() => openAgreement(agreement));
              return true;
            }}
            onPreferences={() => {
              if (!navigate(Section.Settings)) return false;
              setSettingsTab("Notifications");
              return true;
            }}
          />
          <button
            type="button"
            className={`icon-button${busy ? " is-spinning" : ""}`}
            disabled={busy}
            onClick={() => run(refresh)}
            aria-label="Refresh"
            title="Refresh"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
            </svg>
          </button>
        </div>
        {error && (
          <div className="message error" role="alert">
            {error}
            {error.includes("Reload") && (
              <Button variant="quiet" onClick={() => run(refresh)}>
                Reload latest
              </Button>
            )}
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            {notice}
          </div>
        )}
        {busy && (
          <div className="progress" role="status">
            Working…
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
