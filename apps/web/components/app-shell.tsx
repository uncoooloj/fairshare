import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Avatar } from "./person";
import { toneForId } from "../lib/person";
import { NotificationPanel } from "./notification-panel";
import { GlobalSearch } from "./global-search";
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
  workspace: string;
  navigate: (s: Section) => boolean;
  mayLeaveDraft: () => boolean;
  openAgreement: (a: Agreement) => Promise<void>;
  setSettingsTab: Dispatch<SetStateAction<string>>;
  clearSession: () => void;
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
  workspace,
  navigate,
  mayLeaveDraft,
  openAgreement,
  setSettingsTab,
  clearSession,
  children,
}: AppShellProps) {
  const guardedRefresh = () => {
    if (mayLeaveDraft()) void run(refresh);
  };
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
                clearSession();
              });
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main" id="main-content" tabIndex={-1}>
        <div className="workspace-bar">
          <GlobalSearch
            agreements={agreements}
            disabled={busy}
            onOpen={(agreement) => {
              if (!mayLeaveDraft()) return;
              void run(() => openAgreement(agreement));
            }}
          />
          <span className="spacer" />
          <NotificationPanel
            key={`${user.id}:${workspace}`}
            agreements={agreements.map(({ workspaceId, id }) => ({
              workspaceId,
              id,
            }))}
            onOpenAgreement={(workspaceId, id) => {
              const agreement = agreements.find(
                (item) => item.workspaceId === workspaceId && item.id === id,
              );
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
            onClick={guardedRefresh}
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
              <Button variant="quiet" onClick={guardedRefresh}>
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
