import { api } from "./model";

export enum InviteeRole {
  COLLABORATOR = "COLLABORATOR",
}

export enum InvitationStatus {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  REVOKED = "REVOKED",
  EXPIRED = "EXPIRED",
}

export interface Invitee {
  name: string;
  email: string;
  role: InviteeRole;
}

export interface CreatedInvitation {
  invitation: {
    id: string;
    token: string;
    expiresAt: number;
    invitee: Invitee | null;
  };
  agreement: { id: string; name: string };
}

export interface InvitationSummary {
  id: string;
  invitee: Invitee | null;
  expiresAt: number;
  status: InvitationStatus;
  acceptedBy?: { userId: string; name: string | null };
}

const linksPath = (workspaceId: string, agreementId: string) =>
  `workspaces/${encodeURIComponent(workspaceId)}/collaborations/${encodeURIComponent(agreementId)}/invitation-links`;

/** Creates a single-use invite link. The token is only ever returned here. */
export function createInvitation(
  workspaceId: string,
  agreementId: string,
  invitee?: Invitee,
): Promise<CreatedInvitation> {
  return api<CreatedInvitation>(
    linksPath(workspaceId, agreementId),
    "POST",
    invitee ?? {},
  );
}

/** Organizer-only list, newest first. Never includes tokens. */
export async function listInvitations(
  workspaceId: string,
  agreementId: string,
): Promise<InvitationSummary[]> {
  const data = await api<{ invitations: InvitationSummary[] }>(
    linksPath(workspaceId, agreementId),
  );
  return data.invitations;
}

export async function revokeInvitation(
  workspaceId: string,
  agreementId: string,
  invitationId: string,
): Promise<void> {
  await api(
    `${linksPath(workspaceId, agreementId)}/${encodeURIComponent(invitationId)}`,
    "DELETE",
  );
}
