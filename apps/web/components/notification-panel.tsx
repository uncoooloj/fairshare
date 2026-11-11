import { useEffect, useRef, useState } from "react";
import { api } from "../lib/model";
import {
  formatDate,
  notificationLabels,
  type NotificationKind,
} from "../lib/preferences";
import { Button } from "./ui";

export interface NotificationEvent {
  id: string;
  kind: NotificationKind;
  agreementId: string;
  agreementName: string;
  at: string | null;
  message: string;
}

/** A real event feed, not an unread counter: the API does not persist read receipts. */
export function NotificationPanel({
  agreementIds,
  onOpenAgreement,
  onPreferences,
}: {
  agreementIds: string[];
  onOpenAgreement: (id: string) => boolean;
  onPreferences: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
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
  }, [open, refresh]);
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
        className="text-button"
        type="button"
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen(!open)}
      >
        Notifications
      </button>
      {open && (
        <section
          id="notification-panel"
          className="notification-popover"
          aria-label="Notifications"
        >
          <div className="notification-heading">
            <h2>Notifications</h2>
            <button
              ref={close}
              type="button"
              className="text-button"
              onClick={dismiss}
              aria-label="Close notifications"
            >
              Close
            </button>
          </div>
          <p className="muted">
            Recent updates across your agreements. Your notification preferences
            apply.
          </p>
          <div className="notification-toolbar">
            <Button
              type="button"
              variant="quiet"
              disabled={loading}
              onClick={() => setRefresh((value) => value + 1)}
            >
              Refresh updates
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                if (onPreferences()) setOpen(false);
              }}
            >
              Preferences
            </Button>
          </div>
          {loading ? (
            <p role="status">Loading updates…</p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : !events.length ? (
            <p className="notification-empty">
              No matching updates yet. Agreement reviews and payout updates will
              appear here.
            </p>
          ) : (
            <ul className="notification-events">
              {events.map((event) => (
                <li key={event.id}>
                  <small>
                    {notificationLabels[event.kind]?.[0] ?? "Agreement update"}
                  </small>
                  <h3>{event.agreementName}</h3>
                  <p>{event.message}</p>
                  {event.at && (
                    <time dateTime={event.at}>{formatDate(event.at)}</time>
                  )}
                  {agreementIds.includes(event.agreementId) ? (
                    <Button
                      type="button"
                      variant="quiet"
                      onClick={() => {
                        if (onOpenAgreement(event.agreementId)) setOpen(false);
                      }}
                    >
                      View agreement
                    </Button>
                  ) : (
                    <small>
                      Switch to this agreement’s workspace to open it.
                    </small>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
