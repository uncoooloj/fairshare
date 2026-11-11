import { EmailSendButton } from "./email-send-button";
import { invitationEmailToken } from "../lib/email-send";
import { useState } from "react";
import { isPendingMember, type AgreementMember } from "../lib/agreement-api";
import { ApiError, api, type Agreement } from "../lib/model";
import {
  copyText,
  issueInviteLink,
  knownPersonLink,
  liveIssuedLink,
  nudgeMessage,
  shareText,
  ShareOutcome,
  type IssuedLink,
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

/** Shown before any reissue. */
export const oldLinkWarning = (member: AgreementMember) =>
  `${firstName(member.displayName)}’s old link will stop working if you already sent it.`;

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
function PersonShareContent({
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
  const [issued, setIssued] = useState<IssuedLink>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [manual, setManual] = useState("");
  const [confirming, setConfirming] = useState(false);
  if (!canShareLink(member, viewerId, organizer)) return null;
  const name = firstName(member.displayName);
  const currentKnownLink = () =>
    liveIssuedLink(issued) ||
    knownPersonLink(agreement, member, currentOrigin()) ||
    "";
  const known = currentKnownLink();
  const invitationId =
    (issued?.agreement.value.members as AgreementMember[] | undefined)?.find(
      (person) => person.userId === issued?.userId,
    )?.pending?.invitationId ?? member.pending?.invitationId;
  const textFor = (link: string) =>
    mode === ShareMode.Nudge
      ? nudgeMessage(member, agreement.value.name, link)
      : link;

  /** Only after the organizer confirms: any link they already sent stops working. */
  async function getNewLink() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await issueInviteLink(agreement, member, currentOrigin());
      setIssued(result);
      setConfirming(false);
      setNotice("New link ready");
      onAgreementChange?.(result.agreement);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "REVISION_CONFLICT") {
        let refreshFailed = false;
        try {
          const current = await api<Agreement>(
            `workspaces/${encodeURIComponent(agreement.workspaceId)}/collaborations/${encodeURIComponent(agreement.id)}`,
          );
          setIssued(undefined);
          onAgreementChange?.(current);
        } catch {
          refreshFailed = true;
        }
        setNotice(
          refreshFailed
            ? "Couldn’t load the latest agreement. Reload and try again."
            : "Someone else just changed this. Here’s the latest; try again.",
        );
      } else {
        setNotice(
          cause instanceof Error && cause.message
            ? cause.message
            : "Couldn’t get a link. Try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function act(share: boolean) {
    if (busy) return;
    const link = currentKnownLink();
    if (!link) {
      setIssued(undefined);
      setManual("");
      setNotice("This link expired. Get a new link.");
      return;
    }
    setBusy(true);
    setNotice("");
    setManual("");
    try {
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
  // No link on this device: say so, rather than silently replacing one they may have sent.
  if (!known)
    return (
      <div className="person-share">
        {confirming ? (
          <div className="person-share-confirm" role="group">
            <p className="muted">{oldLinkWarning(member)}</p>
            <div className="person-share-buttons">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void getNewLink()}
              >
                {busy ? "Getting link…" : "Get a new link"}
              </Button>
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="secondary"
            aria-label={`Get a new link for ${name}`}
            onClick={() => setConfirming(true)}
          >
            Get a new link
          </Button>
        )}
        {notice && (
          <p className="muted person-share-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    );
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
          {copyLabel}
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
      {organizer && isPendingMember(member) && (
        <EmailSendButton
          key={`${agreement.workspaceId}:${agreement.id}:${issued?.userId ?? member.userId}:${invitationId}`}
          path={`workspaces/${encodeURIComponent(agreement.workspaceId)}/collaborations/${encodeURIComponent(agreement.id)}/people/${encodeURIComponent(issued?.userId ?? member.userId)}/invitation-email`}
          destination={member.pending!.email}
          label="Email invitation"
          payload={() => {
            const token = invitationEmailToken(currentKnownLink());
            return token ? { token } : undefined;
          }}
        />
      )}
      {organizer &&
        !isPendingMember(member) &&
        mode === ShareMode.Nudge &&
        agreement.value.versions.at(-1)?.status === "AWAITING_APPROVAL" &&
        !agreement.value.versions.at(-1)?.approvals[member.userId] && (
          <EmailSendButton
            key={`${agreement.workspaceId}:${agreement.id}:${agreement.value.versions.at(-1)?.id}:${member.userId}`}
            path={`workspaces/${encodeURIComponent(agreement.workspaceId)}/collaborations/${encodeURIComponent(agreement.id)}/versions/${agreement.value.versions.at(-1)?.id}/reminders`}
            destination={member.displayName}
            label="Email review reminder"
            payload={() => ({ recipientId: member.userId })}
          />
        )}
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

/** Keep a new agreement/person independent from a previous screen's local link and email state. */
export function PersonShare(props: Parameters<typeof PersonShareContent>[0]) {
  return (
    <PersonShareContent
      key={`${props.agreement.workspaceId}:${props.agreement.id}:${props.member.userId}:${props.member.pending?.invitationId}`}
      {...props}
    />
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

/** Ready-made messages, with optional explicit email actions, for people still to approve. */
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
                    <span className="muted"> (no link on this device yet)</span>
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
