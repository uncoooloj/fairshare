import { useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/model";
import {
  formatDate,
  notificationLabels,
  type NotificationKind,
} from "../lib/preferences";
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
}

/** A real event feed, not an unread counter: the API does not persist read receipts. */
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
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const settingsTip = useId();
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
            <ul className="notification-events">
              {events.map((event) => {
                const label =
                  notificationLabels[event.kind]?.[0] ?? "Agreement update";
                const body = (
                  <>
                    <span className="notification-kind">{label}</span>
                    <span className="notification-name">
                      {event.agreementName}
                    </span>
                    <span className="notification-body">{event.message}</span>
                    {event.at && (
                      <time dateTime={event.at}>{formatDate(event.at)}</time>
                    )}
                  </>
                );
                const reachable = agreements.some(
                  (agreement) =>
                    agreement.workspaceId === event.workspaceId &&
                    agreement.id === event.agreementId,
                );
                return (
                  <li key={`${event.workspaceId}:${event.id}`}>
                    {reachable ? (
                      // The whole row opens the agreement.
                      <button
                        type="button"
                        className="notification-row"
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
                      </button>
                    ) : (
                      <div className="notification-row">
                        {body}
                        <span className="notification-kind">
                          You no longer have access to this agreement.
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
