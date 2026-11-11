import { publicWebOrigin } from "./public-web-origin";
import {
  isPendingMember,
  replacePersonLink,
  type AgreementMember,
} from "./agreement-api";
import type { Agreement } from "./model";
import { AGREEMENT_INVITE_PREFIX } from "../components/agreement-invitation";
import {
  forgetStaleInviteTokens as forgetExpiredInviteTokens,
  loadStoredInviteTokens,
  replaceInviteLinks,
  saveInviteLinks,
  type StoredInviteToken,
} from "./wizard-persistence";

/** Named-person links deliberately keep their bearer token out of server logs. */
export function personInviteLink(token: string, origin: string) {
  return `${publicWebOrigin(origin)}/invitation#token=${encodeURIComponent(AGREEMENT_INVITE_PREFIX + token)}`;
}

/** Direct link for someone who has joined. One place to change if the route moves. */
export function agreementLink(agreementId: string, origin: string) {
  return `${publicWebOrigin(origin)}/app/agreements/${encodeURIComponent(agreementId)}`;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The ready-made nudge. `link` is left off until it exists. */
export function nudgeMessage(
  member: AgreementMember,
  agreementName: string,
  link?: string,
) {
  const ask = isPendingMember(member)
    ? "can you join and approve"
    : "can you review and approve";
  const text = `Hi ${firstName(member.displayName)}, ${ask} the ${agreementName} split?`;
  return link ? `${text} ${link}` : text;
}

/* Invite tokens are only returned when a link is created, so we keep the ones this
 * device created. The wizard owns the persisted, expiry-checked cache contract. */
const storageKey = (workspaceId: string, agreementId: string) =>
  `fairshare:invite-links:v1:${workspaceId}:${agreementId}`;
const memory = new Map<string, Record<string, StoredInviteToken>>();

function readTokens(workspaceId: string, agreementId: string) {
  const key = storageKey(workspaceId, agreementId);
  return forgetExpiredInviteTokens({
    ...loadStoredInviteTokens(workspaceId, agreementId),
    ...memory.get(key),
  });
}

export function rememberInviteToken(
  workspaceId: string,
  agreementId: string,
  invitationId: string,
  token: string,
  expiresAt: number,
) {
  const key = storageKey(workspaceId, agreementId);
  const next = { token, expiresAt };
  memory.set(key, {
    ...readTokens(workspaceId, agreementId),
    [invitationId]: next,
  });
  saveInviteLinks(workspaceId, agreementId, { [invitationId]: next });
}

/** Drops tokens for people who have joined (or whose link was replaced). Local only. */
export function forgetStaleInviteTokens(agreement: Agreement) {
  const key = storageKey(agreement.workspaceId, agreement.id);
  const open = new Set(
    (agreement.value.members as AgreementMember[])
      .filter(isPendingMember)
      .map((m) => m.pending!.invitationId),
  );
  const tokens = readTokens(agreement.workspaceId, agreement.id);
  const kept = forgetExpiredInviteTokens(
    Object.fromEntries(
      Object.entries(tokens).filter(([invitationId]) => open.has(invitationId)),
    ),
  );
  if (Object.keys(kept).length === Object.keys(tokens).length) return;
  memory.set(key, kept);
  try {
    replaceInviteLinks(agreement.workspaceId, agreement.id, kept);
  } catch {
    // Storage blocked; memory is already trimmed.
  }
}

/** The link we already have for this person, without calling the server. Pending people
 * have one only if this device created it. */
export function knownPersonLink(
  agreement: Agreement,
  member: AgreementMember,
  origin: string,
): string | undefined {
  if (!isPendingMember(member)) return agreementLink(agreement.id, origin);
  const stored = readTokens(agreement.workspaceId, agreement.id)[
    member.pending!.invitationId
  ];
  return stored?.token ? personInviteLink(stored.token, origin) : undefined;
}

export interface IssuedLink {
  agreement: Agreement;
  link: string;
  expiresAt: number;
  /** The person's seat ID after the reissue (`pending:<new invitation>`). */
  userId: string;
}

/** A freshly issued link is usable only until the backend-provided expiry. */
export function liveIssuedLink(
  issued: Pick<IssuedLink, "link" | "expiresAt"> | undefined,
  now = Date.now(),
) {
  return issued && Number.isFinite(issued.expiresAt) && issued.expiresAt > now
    ? issued.link
    : undefined;
}

const inFlight = new Map<string, Promise<IssuedLink>>();

/** Creates a new invite link (the old one stops working). Concurrent presses for the
 * same person share one request; the token is remembered so later presses reuse it. */
export function issueInviteLink(
  agreement: Agreement,
  member: AgreementMember,
  origin: string,
): Promise<IssuedLink> {
  const key = `${agreement.workspaceId}:${agreement.id}:${member.userId}`;
  const running = inFlight.get(key);
  if (running) return running;
  const request = replacePersonLink(
    agreement.workspaceId,
    agreement.id,
    agreement.revision,
    member.userId,
  )
    .then((result) => {
      rememberInviteToken(
        agreement.workspaceId,
        agreement.id,
        result.invitation.id,
        result.invitation.token,
        result.invitation.expiresAt,
      );
      return {
        agreement: result.agreement,
        link: personInviteLink(result.invitation.token, origin),
        expiresAt: result.invitation.expiresAt,
        userId: `pending:${result.invitation.id}`,
      };
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export enum ShareOutcome {
  Shared = "shared",
  Copied = "copied",
  Cancelled = "cancelled",
  /** Neither worked; show the text so the person can copy it by hand. */
  Failed = "failed",
}

export async function copyText(text: string): Promise<ShareOutcome> {
  try {
    await navigator.clipboard.writeText(text);
    return ShareOutcome.Copied;
  } catch {
    return ShareOutcome.Failed;
  }
}

/** Web Share where the browser has it, otherwise copy. */
export async function shareText(share: {
  title: string;
  text?: string;
  url?: string;
}): Promise<ShareOutcome> {
  const fallback = [share.text, share.url].filter(Boolean).join(" ");
  if (typeof navigator !== "undefined" && typeof navigator.share === "function")
    try {
      await navigator.share(share);
      return ShareOutcome.Shared;
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError")
        return ShareOutcome.Cancelled;
    }
  return copyText(fallback);
}
