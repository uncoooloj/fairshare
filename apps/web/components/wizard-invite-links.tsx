"use client";
import { useEffect, useRef, useState } from "react";
import { publicWebOrigin } from "../lib/public-web-origin";
import { AGREEMENT_INVITE_PREFIX } from "./agreement-invitation";

export interface InviteResult {
  key: string;
  name: string;
  email: string;
  token?: string;
  error?: string;
}

export function inviteLink(token: string) {
  return `${publicWebOrigin(location.origin)}/invitation#token=${encodeURIComponent(AGREEMENT_INVITE_PREFIX + token)}`;
}

function InviteRow({ invite }: { invite: InviteResult }) {
  const [copied, setCopied] = useState(false);
  const link = invite.token ? inviteLink(invite.token) : "";
  return (
    <li className="wiz-invite">
      <span className="wiz-invite-who">
        <strong>{invite.name}</strong>
        <small>{invite.email}</small>
      </span>
      {invite.token ? (
        <span className="wiz-invite-link">
          <input
            readOnly
            value={link}
            aria-label={`Invite link for ${invite.name}`}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </span>
      ) : (
        <span className="wiz-error" role="alert">
          {invite.error || "Couldn’t create this link."}
        </span>
      )}
    </li>
  );
}

/** Shown once after creation: tokens are only returned here, and no email is sent. */
export function InviteLinks({
  invites,
  retrying,
  onRetry,
}: {
  invites: InviteResult[];
  retrying: boolean;
  onRetry(): void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const failed = invites.some((invite) => !invite.token);
  return (
    <section className="wiz-step" aria-labelledby="wiz-invites-title">
      <h1 id="wiz-invites-title" ref={heading} tabIndex={-1}>
        Share invite links
      </h1>
      <p className="wiz-lede">
        Your agreement is created. Fairshare doesn’t send email yet, so copy
        each link and send it yourself. Each link works once.
      </p>
      <ul className="wiz-invites">
        {invites.map((invite) => (
          <InviteRow key={invite.key} invite={invite} />
        ))}
      </ul>
      {failed && (
        <button
          type="button"
          className="button secondary"
          disabled={retrying}
          onClick={onRetry}
        >
          {retrying ? "Retrying…" : "Retry failed links"}
        </button>
      )}
      <p className="wiz-hint">
        You can also invite people later from the agreement’s People tab.
      </p>
    </section>
  );
}
