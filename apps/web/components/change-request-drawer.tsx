"use client";
import { useEffect, useId, useRef } from "react";
import type { Agreement } from "../lib/model";
import { formatDate } from "../lib/preferences";
import {
  WrongPart,
  wrongPartLabels,
  wrongPartTopics,
} from "./something-wrong-drawer";
import { Button } from "./ui";

/** A collaborator's "Something's not right", as the organizer reads it. */
export interface ChangeRequestView {
  userId: string;
  /** First name. */
  name: string;
  part: WrongPart;
  note: string;
  at: string;
}

/** Splits the stored reason back into the part it is about and the note, e.g.
 * "Revenue split: I agreed to 25%" → SPLIT + "I agreed to 25%". No known prefix → OTHER. */
export function parseChangeRequest(reason: string): {
  part: WrongPart;
  note: string;
} {
  for (const part of Object.values(WrongPart)) {
    const topic = wrongPartTopics[part];
    if (topic && reason.startsWith(`${topic}: `))
      return { part, note: reason.slice(topic.length + 2).trim() };
  }
  return { part: WrongPart.OTHER, note: reason.trim() };
}

/** Requests still waiting on the organizer: those on the latest proposal while it is
 * back in draft. Sending a new version leaves them behind on the old one (resolved). */
export function openChangeRequests(agreement: Agreement): ChangeRequestView[] {
  const latest = agreement.value.versions.at(-1);
  if (latest?.status !== "DRAFT") return [];
  return latest.changeRequests.map((request) => {
    const member = agreement.value.members.find(
      (m) => m.userId === request.userId,
    );
    const name =
      member?.displayName.trim().split(/\s+/)[0] ||
      member?.displayName ||
      "Someone";
    return {
      userId: request.userId,
      name,
      at: request.at,
      ...parseChangeRequest(request.reason),
    };
  });
}

/** "the split", "the advance", "the fees", "refunds", "the agreement". */
export function partPhrase(part: WrongPart) {
  switch (part) {
    case WrongPart.REFUNDS:
      return "refunds";
    case WrongPart.OTHER:
      return "the agreement";
    default:
      return `the ${wrongPartLabels[part].toLowerCase()}`;
  }
}

/** The organizer's side of "Something's not right": who asked, about what, their note, and Fix it. */
export function ChangeRequestDrawer({
  requests,
  onFix,
  onClose,
}: {
  requests: ChangeRequestView[];
  onFix: (request: ChangeRequestView) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    panel.current?.querySelector<HTMLElement>("h2")?.focus();
    return () => {
      if (opener.current instanceof HTMLElement && opener.current.isConnected)
        opener.current.focus();
    };
  }, []);
  const latest = requests.at(-1);
  const names = [...new Set(requests.map((r) => r.name))];
  return (
    <div
      className="collab-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="collab-drawer gr-request"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key !== "Tab") return;
          const items = [
            ...(panel.current?.querySelectorAll<HTMLElement>(
              "button:not([disabled])",
            ) ?? []),
          ];
          if (!items.length) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 id={titleId} tabIndex={-1}>
          {names.length
            ? `${names.join(" and ")} asked for a change`
            : "No change requested"}
        </h2>
        {requests.map((request, index) => (
          <figure key={`${request.userId}:${index}`} className="gr-note">
            <figcaption>
              <span className="gr-part">About {partPhrase(request.part)}</span>
              <time dateTime={request.at}>{formatDate(request.at)}</time>
            </figcaption>
            <blockquote>{request.note}</blockquote>
          </figure>
        ))}
        <p className="muted collab-hint">
          Change what needs fixing and send it again. Everyone approves again.
        </p>
        <div className="collab-drawer-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          {latest && (
            <Button type="button" onClick={() => onFix(latest)}>
              Fix it
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
