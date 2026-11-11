import { useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/model";
import { type NotificationKind } from "../lib/preferences";
import { CloseButton } from "./close-button";
import { GearIcon } from "./icons";

export interface NotificationEvent {
  id: string;
  kind: NotificationKind;
  workspaceId: string;
  agreementId: string;
  agreementName: string;
  at: string | null;
  message: string;
  read: boolean;
}

type NotificationGroup = "today" | "earlier";

function notificationGroup(
  at: string | null,
  now = new Date(),
): NotificationGroup {
  if (!at) return "earlier";
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "earlier";
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
    ? "today"
    : "earlier";
}

function relativeTime(at: string | null, now = Date.now()) {
  if (!at) return null;
  const date = new Date(at);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  const minutes = Math.max(0, Math.floor((now - time) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const current = new Date(now);
  const hours = Math.floor(minutes / 60);
  if (notificationGroup(at, current) === "today") return `${hours}h ago`;
  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  if (notificationGroup(at, yesterday) === "today") return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function NotificationIcon({ kind }: { kind: NotificationKind }) {
  const icon = {
    approvalRequests: [
      "notification-event-icon--blue",
      "M7 3h8l3 3v14H7zM10 12l2 2 3-4",
    ],
    versionChanges: [
      "notification-event-icon--blue",
      "M7 3h8l3 3v14H7zM10 12l2 2 3-4",
    ],
    payoutCompleted: [
      "notification-event-icon--green",
      "m8 12 2.5 2.5L16 9M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    ],
    payoutFailed: [
      "notification-event-icon--red",
      "m9 9 6 6m0-6-6 6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    ],
    exceptions: [
      "notification-event-icon--red",
      "M12 8v5m0 4h.01M10 3 2.8 17.4A2 2 0 0 0 4.6 20h14.8a2 2 0 0 0 1.8-2.6L14 3a2.2 2.2 0 0 0-4 0Z",
    ],
  }[kind];
  return (
    <span className={`notification-event-icon ${icon[0]}`} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={icon[1]} />
      </svg>
    </span>
  );
}

/** A real event feed with user-scoped persisted read receipts. */
export function NotificationPanel({
  agreements,
  onOpenAgreement,
  onPreferences,
}: {
  agreements: { workspaceId: string; id: string }[];
  onOpenAgreement: (workspaceId: string, id: string) => boolean;
  onPreferences: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [markingRead, setMarkingRead] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const settingsTip = useId();
  const groupedEvents = events.reduce<
    Record<NotificationGroup, NotificationEvent[]>
  >(
    (groups, event) => {
      groups[notificationGroup(event.at)].push(event);
      return groups;
    },
    { today: [], earlier: [] },
  );
  const hasUnread = events.some((event) => !event.read);
  // Fetches every time the panel opens, so there is no separate refresh control.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    api<{ events: NotificationEvent[] }>("auth/notifications")
      .then((result) => {
        if (active) setEvents(result.events);
      })
      .catch(() => {
        if (active) setError("Notifications couldn’t load. Try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function dismiss() {
    setOpen(false);
    trigger.current?.focus();
  }
  async function markAllRead() {
    if (!hasUnread || markingRead) return;
    setMarkingRead(true);
    try {
      await api("auth/notifications/mark-all-read", "POST");
      setEvents((current) =>
        current.map((event) => ({ ...event, read: true })),
      );
    } catch {
      setError("Notifications couldn’t be marked as read. Try again.");
    } finally {
      setMarkingRead(false);
    }
  }
  return (
    <div
      className="notification-anchor"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          dismiss();
        }
      }}
    >
      <button
        ref={trigger}
        className="icon-button"
        type="button"
        aria-expanded={open}
        aria-controls="notification-panel"
        aria-label="Open notifications"
        title="Open notifications"
        onClick={() => setOpen(!open)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      </button>
      {open && (
        <section
          id="notification-panel"
          className="notification-popover"
          aria-label="Notifications"
        >
          <div className="notification-heading">
            <h2>Notifications</h2>
            <div className="notification-heading-actions">
              <button
                type="button"
                className="notification-mark-read"
                disabled={!hasUnread || markingRead}
                onClick={() => void markAllRead()}
              >
                {markingRead ? "Marking…" : "Mark all read"}
              </button>
              <span className="notification-tip-anchor">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Notification settings"
                  aria-describedby={settingsTip}
                  onClick={() => {
                    if (onPreferences()) setOpen(false);
                  }}
                >
                  <GearIcon />
                </button>
                <span
                  role="tooltip"
                  id={settingsTip}
                  className="notification-tip"
                >
                  Notification settings
                </span>
              </span>
              <CloseButton
                ref={close}
                label="Close notifications"
                onClick={dismiss}
              />
            </div>
          </div>
          {loading ? (
            <p role="status">Loading updates…</p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : !events.length ? (
            <p className="notification-empty">
              Nothing yet. Approvals and payouts show up here.
            </p>
          ) : (
            <div className="notification-groups">
              {(["today", "earlier"] as const).map((group) =>
                groupedEvents[group].length ? (
                  <section
                    className="notification-group"
                    key={group}
                    aria-label={group === "today" ? "Today" : "Earlier"}
                  >
                    <h3>{group === "today" ? "Today" : "Earlier"}</h3>
                    <ul className="notification-events">
                      {groupedEvents[group].map((event) => {
                        const relative = relativeTime(event.at);
                        const body = (
                          <span className="notification-row-content">
                            <NotificationIcon kind={event.kind} />
                            <span className="notification-event-copy">
                              <span className="notification-headline">
                                {event.message}
                              </span>
                              <span className="notification-detail">
                                {event.agreementName}
                                {relative ? ` · ${relative}` : ""}
                              </span>
                            </span>
                          </span>
                        );
                        const reachable = agreements.some(
                          (agreement) =>
                            agreement.workspaceId === event.workspaceId &&
                            agreement.id === event.agreementId,
                        );
                        return (
                          <li key={`${event.workspaceId}:${event.id}`}>
                            {reachable ? (
                              <button
                                type="button"
                                className={`notification-row${event.read ? "" : " is-unread"}`}
                                onClick={() => {
                                  if (
                                    onOpenAgreement(
                                      event.workspaceId,
                                      event.agreementId,
                                    )
                                  )
                                    setOpen(false);
                                }}
                              >
                                {body}
                                {!event.read && (
                                  <span
                                    className="notification-unread-dot"
                                    aria-hidden="true"
                                  />
                                )}
                              </button>
                            ) : (
                              <div
                                className={`notification-row${event.read ? "" : " is-unread"}`}
                              >
                                {body}
                                {!event.read && (
                                  <span
                                    className="notification-unread-dot"
                                    aria-hidden="true"
                                  />
                                )}
                                <span className="notification-access-note">
                                  You no longer have access to this agreement.
                                </span>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null,
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
