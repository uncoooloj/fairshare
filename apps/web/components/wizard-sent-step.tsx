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

function InviteRow({ invite }: { invite: SentInvite }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const link = invite.token ? inviteLink(invite.token) : "";
  return (
    <li className="wiz-invite">
      <span className="wiz-invite-who">
        <strong>{invite.name}</strong>
        <small>{invite.email}</small>
      </span>
      {link ? (
        <span className="wiz-invite-link">
          {failed && (
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
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                // No clipboard access: show the link so it can be copied by hand.
                setFailed(true);
              }
            }}
          >
            {copied ? "Copied" : "Copy invite link"}
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

/** Step 7. Invite tokens only exist here, and no email is sent. */
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
