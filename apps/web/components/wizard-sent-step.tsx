"use client";
import { useEffect, useRef, useState } from "react";
import { EmailSendButton } from "./email-send-button";
import { useEmailDelivery } from "../lib/email-capability";
import { publicWebOrigin } from "../lib/public-web-origin";
import { AGREEMENT_INVITE_PREFIX } from "./agreement-invitation";

export interface SentInvite {
  key: string;
  workspaceId?: string;
  agreementId?: string;
  userId?: string;
  invitationId?: string;
  name: string;
  email: string;
  token?: string;
  expiresAt?: number;
}

export function inviteIsLive(
  token: string | undefined,
  expiresAt: number | undefined,
  now = Date.now(),
) {
  return (
    typeof token === "string" &&
    Number.isFinite(expiresAt) &&
    (expiresAt as number) > now
  );
}

export function inviteLink(token: string) {
  return `${publicWebOrigin(location.origin)}/invitation#token=${encodeURIComponent(AGREEMENT_INVITE_PREFIX + token)}`;
}

/** Recheck immediately before an action: a link can expire while this screen is open. */
export function liveInviteLink(
  invite: SentInvite,
  origin: string,
  now = Date.now(),
) {
  return inviteIsLive(invite.token, invite.expiresAt, now)
    ? `${publicWebOrigin(origin)}/invitation#token=${encodeURIComponent(AGREEMENT_INVITE_PREFIX + invite.token)}`
    : undefined;
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
  EXPIRED = "expired",
}

function InviteRow({ invite }: { invite: SentInvite }) {
  const [state, setState] = useState(RowState.IDLE);
  const link = liveInviteLink(invite, location.origin) || "";

  async function copy() {
    const currentLink = liveInviteLink(invite, location.origin);
    if (!currentLink) {
      setState(RowState.EXPIRED);
      return;
    }
    try {
      await navigator.clipboard.writeText(currentLink);
      setState(RowState.COPIED);
    } catch {
      // No clipboard access: show the link so it can be copied by hand.
      setState(RowState.SHOW_LINK);
    }
  }

  async function share() {
    const currentLink = liveInviteLink(invite, location.origin);
    if (!currentLink) {
      setState(RowState.EXPIRED);
      return;
    }
    const data: ShareData = {
      title: "Approve our split",
      text: `${firstName(invite.name)}, here's your link to review and approve the split.`,
      url: currentLink,
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
      {state === RowState.EXPIRED ? (
        <small className="wiz-hint">
          This link expired. Create a new link from the agreement’s People tab.
        </small>
      ) : link ? (
        <div className="wiz-invite-link">
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
          {invite.workspaceId && invite.agreementId && invite.userId && (
            <EmailSendButton
              key={`${invite.workspaceId}:${invite.agreementId}:${invite.userId}:${invite.invitationId}`}
              path={`workspaces/${encodeURIComponent(invite.workspaceId)}/collaborations/${encodeURIComponent(invite.agreementId)}/people/${encodeURIComponent(invite.userId)}/invitation-email`}
              destination={invite.email}
              label="Email invitation"
              payload={() =>
                liveInviteLink(invite, location.origin)
                  ? { token: invite.token }
                  : undefined
              }
            />
          )}
        </div>
      ) : (
        <small className="wiz-hint">
          Their link is on the agreement’s People tab.
        </small>
      )}
    </li>
  );
}

export function invitationInstructions(emailDelivery: boolean) {
  return emailDelivery
    ? "Share each person’s link or email their invitation so they can review and approve the split."
    : "Share each person’s link so they can review and approve the split.";
}

/** Step 7. Invitations are ready, but the organizer still needs to share them. */
export function WizardSentStep({ invites }: { invites: SentInvite[] }) {
  const emailDelivery = useEmailDelivery();
  const names = joinNames(invites.map((invite) => firstName(invite.name)));
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section className="wiz-step" aria-labelledby="wiz-step-title">
      <h1 id="wiz-step-title" ref={heading} tabIndex={-1}>
        {names ? `Invite ${names}` : "Invite your collaborators"}
      </h1>
      <p className="wiz-lede">{invitationInstructions(emailDelivery)}</p>
      <ul className="wiz-invites">
        {invites.map((invite) => (
          <InviteRow
            key={`${invite.workspaceId}:${invite.agreementId}:${invite.userId}:${invite.invitationId}:${invite.key}`}
            invite={invite}
          />
        ))}
      </ul>
    </section>
  );
}
