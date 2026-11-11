"use client";
import { useEffect, useRef, useState } from "react";
import { publicWebOrigin } from "../lib/public-web-origin";
import { AGREEMENT_INVITE_PREFIX } from "./agreement-invitation";

export interface SentInvite {
  key: string;
  name: string;
  email: string;
  token?: string;
}

export function inviteLink(token: string) {
  return `${publicWebOrigin(location.origin)}/invitation#token=${encodeURIComponent(AGREEMENT_INVITE_PREFIX + token)}`;
}

/** "Jordan", "Jordan and Riley", "Jordan, Riley and Sam". */
export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** What the Share button can do here: the system share sheet, or a copy as the fallback. */
export enum ShareMethod {
  SHEET = "sheet",
  COPY = "copy",
}

export function shareMethod(
  nav: Pick<Navigator, "share" | "canShare"> | undefined,
  data: ShareData,
): ShareMethod {
  if (!nav || typeof nav.share !== "function") return ShareMethod.COPY;
  if (typeof nav.canShare === "function" && !nav.canShare(data))
    return ShareMethod.COPY;
  return ShareMethod.SHEET;
}

enum RowState {
  IDLE = "idle",
  COPIED = "copied",
  SHOW_LINK = "show-link",
}

function InviteRow({ invite }: { invite: SentInvite }) {
  const [state, setState] = useState(RowState.IDLE);
  const link = invite.token ? inviteLink(invite.token) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setState(RowState.COPIED);
    } catch {
      // No clipboard access: show the link so it can be copied by hand.
      setState(RowState.SHOW_LINK);
    }
  }

  async function share() {
    const data: ShareData = {
      title: "Approve our split",
      text: `${firstName(invite.name)}, here's your link to review and approve the split.`,
      url: link,
    };
    if (shareMethod(globalThis.navigator, data) === ShareMethod.COPY)
      return copy();
    try {
      await navigator.share(data);
    } catch (cause) {
      // Closing the share sheet isn't a failure; anything else falls back to copying.
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      await copy();
    }
  }

  return (
    <li className="wiz-invite">
      <span className="wiz-invite-who">
        <strong>{invite.name}</strong>
        <small>{invite.email}</small>
      </span>
      {link ? (
        <span className="wiz-invite-link">
          {state === RowState.SHOW_LINK && (
            <input
              readOnly
              value={link}
              aria-label={`Invite link for ${invite.name}`}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
          <button
            type="button"
            className="button secondary"
            aria-label={`Copy ${firstName(invite.name)}'s link`}
            onClick={() => void copy()}
          >
            {state === RowState.COPIED ? "Copied" : "Copy link"}
          </button>
          <button
            type="button"
            className="button secondary"
            aria-label={`Share ${firstName(invite.name)}'s link`}
            onClick={() => void share()}
          >
            Share
          </button>
        </span>
      ) : (
        <small className="wiz-hint">
          Their link is on the agreement’s People tab.
        </small>
      )}
    </li>
  );
}

/** Step 7. No email is sent: the organizer copies or shares each person's link. */
export function WizardSentStep({ invites }: { invites: SentInvite[] }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section className="wiz-step" aria-labelledby="wiz-step-title">
      <h1 id="wiz-step-title" ref={heading} tabIndex={-1}>
        Sent to {joinNames(invites.map((invite) => firstName(invite.name)))}
      </h1>
      <p className="wiz-lede">Send them their link. We don’t email it yet.</p>
      <ul className="wiz-invites">
        {invites.map((invite) => (
          <InviteRow key={invite.key} invite={invite} />
        ))}
      </ul>
    </section>
  );
}
