import {
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
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
  // Phones: the nav is a sheet behind a menu button, and search opens from an icon.
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      document.getElementById("app-menu-button")?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  useEffect(() => {
    if (searchOpen)
      document
        .querySelector<HTMLInputElement>(".workspace-bar .global-search input")
        ?.focus();
  }, [searchOpen]);
  return (
    <div
      className={[
        "app-shell",
        menuOpen && "menu-open",
        searchOpen && "search-open",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar">
        <div className="shell-bar">
          <Logo />
          <div className="shell-bar-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Search agreements"
              aria-expanded={searchOpen}
              aria-controls="workspace-bar"
              onClick={() => {
                setMenuOpen(false);
                setSearchOpen((open) => !open);
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="m20 20-4.2-4.2M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
              </svg>
            </button>
            <button
              type="button"
              id="app-menu-button"
              className="icon-button"
              aria-label="Menu"
              aria-expanded={menuOpen}
              aria-controls="app-menu"
              onClick={() => {
                setSearchOpen(false);
                setMenuOpen((open) => !open);
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                aria-hidden="true"
              >
                {menuOpen ? (
                  <path d="M6 6l12 12M18 6 6 18" />
                ) : (
                  <path d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
        {menuOpen && (
          // Tapping outside the sheet closes it; Escape and the menu button do the same for keyboards.
          <div
            className="app-menu-backdrop"
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
          />
        )}
        <div id="app-menu" className="app-menu">
          <nav aria-label="Main navigation">
            {Object.values(Section).map((s) => (
              <button
                key={s}
                aria-current={section === s ? "page" : undefined}
                className={section === s ? "nav-item selected" : "nav-item"}
                onClick={() => {
                  if (navigate(s)) setMenuOpen(false);
                }}
              >
                <Icon name={s} />
                {s}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button
              type="button"
              className="text-button app-menu-refresh"
              disabled={busy}
              onClick={() => {
                setMenuOpen(false);
                guardedRefresh();
              }}
            >
              Refresh
            </button>
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
        </div>
      </aside>
      <main className="main" id="main-content" tabIndex={-1}>
        <div className="workspace-bar" id="workspace-bar">
          <GlobalSearch
            agreements={agreements}
            disabled={busy}
            onOpen={(agreement) => {
              if (!mayLeaveDraft()) return;
              setSearchOpen(false);
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
