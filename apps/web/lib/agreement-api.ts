import { api, type Agreement, type Member, type Rules } from "./model";

/** Prefix of the placeholder user ID a named person has until they join. */
export const PENDING_USER_PREFIX = "pending:";

/** A person the organizer named who has not accepted their invitation yet. */
export interface PendingInvite {
  invitationId: string;
  email: string;
}

/** Agreement members as the API returns them; `pending` is set until the person joins.
 * Rules (shares, advance recipient) refer to a pending person by their placeholder `userId`,
 * which the API rewrites to the real user ID when they accept. */
export interface AgreementMember extends Member {
  pending?: PendingInvite;
}

/** The userId rules must use for a person named by `invitationId` who has not joined. */
export const pendingUserId = (invitationId: string) =>
  PENDING_USER_PREFIX + invitationId;

export const isPendingMember = (member: AgreementMember) => !!member.pending;

/** Single-use link for a named person. The token is only ever returned at creation. */
export interface PersonInvitation {
  id: string;
  token: string;
  expiresAt: number;
}

export interface AddedPerson {
  agreement: Agreement;
  invitation: PersonInvitation;
}

const agreementPath = (workspaceId: string, agreementId: string) =>
  `workspaces/${encodeURIComponent(workspaceId)}/collaborations/${encodeURIComponent(agreementId)}`;

/** Organizer names someone by email before they join. Allowed until the rules are sent.
 * Their seat's userId is `pendingUserId(invitation.id)`. */
export function addPerson(
  workspaceId: string,
  agreementId: string,
  expectedRevision: number,
  person: { name: string; email: string },
): Promise<AddedPerson> {
  return api<AddedPerson>(
    `${agreementPath(workspaceId, agreementId)}/people`,
    "POST",
    { expectedRevision, name: person.name, email: person.email },
  );
}

/** Organizer removes a person (pending or joined) before the rules are sent.
 * A pending person's link is revoked in the same transaction. */
export async function removePerson(
  workspaceId: string,
  agreementId: string,
  expectedRevision: number,
  userId: string,
): Promise<Agreement> {
  const data = await api<{ agreement: Agreement }>(
    `${agreementPath(workspaceId, agreementId)}/people/${encodeURIComponent(userId)}?expectedRevision=${expectedRevision}`,
    "DELETE",
  );
  return data.agreement;
}

/** Organizer replaces a pending person's link (lost or expired); works after sending too.
 * The old link stops working and the placeholder becomes `pendingUserId(invitation.id)`. */
export function replacePersonLink(
  workspaceId: string,
  agreementId: string,
  expectedRevision: number,
  userId: string,
): Promise<AddedPerson> {
  return api<AddedPerson>(
    `${agreementPath(workspaceId, agreementId)}/people/${encodeURIComponent(userId)}/invitation`,
    "POST",
    { expectedRevision },
  );
}

/** "Send for approval": saves the rules, records the organizer's approval and sends them,
 * in one transaction. If nobody else needs to approve, the rules switch on immediately
 * (`agreement.value.activeVersionId` is set). */
export function submitForApproval(
  workspaceId: string,
  agreementId: string,
  expectedRevision: number,
  rules: Rules,
): Promise<Agreement> {
  return api<Agreement>(
    `${agreementPath(workspaceId, agreementId)}/submit`,
    "POST",
    { expectedRevision, rules },
  );
}

/** Discards a private draft with its documents and links. Organizer only; refused once the
 * rules were ever sent or any payment exists. */
export async function deleteDraft(
  workspaceId: string,
  agreementId: string,
  expectedRevision: number,
): Promise<void> {
  await api(
    `${agreementPath(workspaceId, agreementId)}?expectedRevision=${expectedRevision}`,
    "DELETE",
  );
}

/** The organizer's open offer to hand the role to another joined member. */
export interface OrganizerHandover {
  fromUserId: string;
  toUserId: string;
  at: string;
}

/** The open handover offer on an agreement, if any. */
export const organizerHandoverOf = (
  agreement: Agreement,
): OrganizerHandover | undefined =>
  (agreement.value as { organizerHandover?: OrganizerHandover })
    .organizerHandover;

const handoverPath = (workspaceId: string, agreementId: string) =>
  `${agreementPath(workspaceId, agreementId)}/organizer-transfer`;

/** Organizer offers the role to a joined member. Offering again replaces the open offer.
 * Nothing about the split changes, now or when they accept. */
export function offerOrganizerHandover(
  workspaceId: string,
  agreementId: string,
  expectedRevision: number,
  toUserId: string,
): Promise<Agreement> {
  return api<Agreement>(handoverPath(workspaceId, agreementId), "POST", {
    expectedRevision,
    toUserId,
  });
}

/** Organizer withdraws the open offer. */
export function cancelOrganizerHandover(
  workspaceId: string,
  agreementId: string,
  expectedRevision: number,
): Promise<Agreement> {
  return api<Agreement>(
    `${handoverPath(workspaceId, agreementId)}?expectedRevision=${expectedRevision}`,
    "DELETE",
  );
}

/** The person the offer names takes over organizing; the roles swap. */
export function acceptOrganizerHandover(
  workspaceId: string,
  agreementId: string,
  expectedRevision: number,
): Promise<Agreement> {
  return api<Agreement>(
    `${handoverPath(workspaceId, agreementId)}/accept`,
    "POST",
    { expectedRevision },
  );
}

/** The person the offer names says no; nothing else changes. */
export function declineOrganizerHandover(
  workspaceId: string,
  agreementId: string,
  expectedRevision: number,
): Promise<Agreement> {
  return api<Agreement>(
    `${handoverPath(workspaceId, agreementId)}/decline`,
    "POST",
    { expectedRevision },
  );
}
