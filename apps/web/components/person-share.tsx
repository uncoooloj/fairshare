import { useState } from "react";
import { isPendingMember, type AgreementMember } from "../lib/agreement-api";
import type { Agreement } from "../lib/model";
import {
  copyText,
  issueInviteLink,
  knownPersonLink,
  nudgeMessage,
  shareText,
  ShareOutcome,
} from "../lib/share-link";
import { Drawer } from "./allocation-drawer";
import { Button } from "./ui";

export enum ShareMode {
  /** Copy or share the person's link. */
  Link = "link",
  /** Copy or share a ready-made message that ends with their link. */
  Nudge = "nudge",
}

const currentOrigin = () =>
  typeof location === "undefined" ? "" : location.origin;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Invite links are the organizer's; anyone can share the agreement link with themselves. */
export function canShareLink(
  member: AgreementMember,
  viewerId: string,
  organizer: boolean,
) {
  return isPendingMember(member)
    ? organizer
    : organizer || member.userId === viewerId;
}

/** Copy and Share for one person. Nothing is requested until a button is pressed; a pending
 * person's link is created on the first press and reused after that. */
export function PersonShare({
  agreement,
  member,
  viewerId,
  organizer,
  mode = ShareMode.Link,
  onAgreementChange,
}: {
  agreement: Agreement;
  member: AgreementMember;
  viewerId: string;
  organizer: boolean;
  mode?: ShareMode;
  onAgreementChange?: (agreement: Agreement) => void;
}) {
  const [issued, setIssued] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [manual, setManual] = useState("");
  if (!canShareLink(member, viewerId, organizer)) return null;
  const name = firstName(member.displayName);
  const known =
    issued || knownPersonLink(agreement, member, currentOrigin()) || "";
  const textFor = (link: string) =>
    mode === ShareMode.Nudge
      ? nudgeMessage(member, agreement.value.name, link)
      : link;

  async function linkNow() {
    if (known) return known;
    const result = await issueInviteLink(agreement, member, currentOrigin());
    setIssued(result.link);
    onAgreementChange?.(result.agreement);
    return result.link;
  }

  async function act(share: boolean) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    setManual("");
    try {
      const link = await linkNow();
      const text = textFor(link);
      const outcome = share
        ? await shareText(
            mode === ShareMode.Nudge
              ? { title: agreement.value.name, text }
              : { title: agreement.value.name, url: link },
          )
        : await copyText(text);
      if (outcome === ShareOutcome.Failed) {
        setManual(text);
        setNotice("Copy it from the box below.");
      } else if (outcome === ShareOutcome.Copied)
        setNotice(mode === ShareMode.Nudge ? "Message copied" : "Link copied");
      else if (outcome === ShareOutcome.Shared) setNotice("Shared");
    } catch (cause) {
      setNotice(
        cause instanceof Error && cause.message
          ? cause.message
          : "Couldn’t get a link. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const copyLabel = mode === ShareMode.Nudge ? "Copy message" : "Copy link";
  return (
    <div className="person-share">
      <div className="person-share-buttons">
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          aria-label={`${copyLabel} for ${name}`}
          onClick={() => void act(false)}
        >
          {busy ? "Getting link…" : copyLabel}
        </Button>
        <Button
          type="button"
          variant="quiet"
          disabled={busy}
          aria-label={`Share ${mode === ShareMode.Nudge ? "message" : "link"} for ${name}`}
          onClick={() => void act(true)}
        >
          Share
        </Button>
      </div>
      {notice && (
        <p className="muted person-share-notice" role="status">
          {notice}
        </p>
      )}
      {manual && (
        <textarea
          aria-label={`${mode === ShareMode.Nudge ? "Message" : "Link"} for ${name}`}
          readOnly
          rows={mode === ShareMode.Nudge ? 3 : 2}
          value={manual}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  );
}

/** People who still need to approve the latest version, other than the viewer. */
export function peopleToNudge(agreement: Agreement, viewerId: string) {
  const latest = agreement.value.versions.at(-1);
  if (latest?.status !== "AWAITING_APPROVAL") return [];
  return (agreement.value.members as AgreementMember[]).filter(
    (m) => m.userId !== viewerId && !latest.approvals[m.userId],
  );
}

/** Ready-made messages for each person still to approve. Nothing is sent from here. */
export function NudgeDrawer({
  agreement,
  userId,
  onClose,
  onAgreementChange,
}: {
  agreement: Agreement;
  userId: string;
  onClose: () => void;
  onAgreementChange?: (agreement: Agreement) => void;
}) {
  const people = peopleToNudge(agreement, userId);
  return (
    <Drawer label="Nudge" onClose={onClose}>
      <p className="muted">
        Send this from your own messages or email. Each link is just for that
        person.
      </p>
      {people.length ? (
        <ul className="nudge-list">
          {people.map((member) => {
            const link = knownPersonLink(agreement, member, currentOrigin());
            return (
              <li key={member.userId} className="nudge-person">
                <strong>{member.displayName}</strong>
                {isPendingMember(member) && (
                  <small className="muted"> Hasn’t joined yet</small>
                )}
                <blockquote className="nudge-message">
                  {nudgeMessage(member, agreement.value.name, link)}
                  {!link && (
                    <span className="muted">
                      {" "}
                      (their link is added when you copy)
                    </span>
                  )}
                </blockquote>
                <PersonShare
                  agreement={agreement}
                  member={member}
                  viewerId={userId}
                  organizer
                  mode={ShareMode.Nudge}
                  onAgreementChange={onAgreementChange}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p>Everyone has approved.</p>
      )}
    </Drawer>
  );
}
