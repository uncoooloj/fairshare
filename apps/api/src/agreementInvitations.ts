import { randomBytes, randomUUID } from "node:crypto";
import {
  addPendingMember,
  bindPendingMember,
  DomainError,
  MemberRole,
  reissuePendingInvite,
  removeMember,
  rulesEverSent,
  type Collaboration,
} from "@fairshare/domain";
import type { FairshareApp } from "./app.js";
import type { AggregateStore } from "./fairshare.js";
import { ApiError, digest, Role } from "./identity.js";
import { readPayoutDestination } from "./payoutAccounts.js";

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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function invalid(message: string): never {
  throw new ApiError(400, "INVALID_INVITEE", message);
}
/** Invitee details are all-or-nothing; legacy link-only invitations send none. */
export function parseInvitee(body: unknown): Invitee | null {
  const input = (body ?? {}) as Record<string, unknown>;
  const { name, email, role } = input;
  if (
    [name, email, role].every((value) => value === undefined || value === null)
  )
    return null;
  if (typeof name !== "string" || typeof email !== "string")
    invalid("Add a name, email and role for this person.");
  const trimmedName = name.trim();
  if (trimmedName.length < 1 || trimmedName.length > 80)
    invalid("Names must be 1 to 80 characters.");
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length > 254 || !EMAIL.test(normalizedEmail))
    invalid("Enter a valid email address.");
  if (!Object.values(InviteeRole).includes(role as InviteeRole))
    invalid("Choose a valid role.");
  return {
    name: trimmedName,
    email: normalizedEmail,
    role: role as InviteeRole,
  };
}

const pendingSeat = (c: Collaboration, invitationId: string) =>
  c.members.find((m) => m.pending?.invitationId === invitationId);
const INVITE_TTL_MS = 48 * 3600000;
function expectedRevision(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1)
    throw new DomainError("INVALID_INPUT", "expectedRevision required");
  return n;
}

/** Agreement links grant workspace membership AND a draft roster seat, never approval.
 * A link made for a named person (POST …/people) binds them to the seat the rules already name. */
export function registerAgreementInvitations(
  app: FairshareApp,
  aggregates: AggregateStore,
) {
  const store = app.store;
  store.db.exec(`CREATE TABLE IF NOT EXISTS fairshare_agreement_invites(
    id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, workspace_id TEXT NOT NULL,
    agreement_id TEXT NOT NULL, created_by TEXT NOT NULL, expires_at INTEGER NOT NULL,
    accepted_at INTEGER, revoked_at INTEGER);`);
  const inviteColumns = new Set(
    (
      store.db
        .prepare("PRAGMA table_info(fairshare_agreement_invites)")
        .all() as any[]
    ).map((row) => row.name),
  );
  for (const column of [
    "invitee_name",
    "invitee_email",
    "invitee_role",
    "accepted_by",
  ])
    if (!inviteColumns.has(column))
      store.db.exec(
        `ALTER TABLE fairshare_agreement_invites ADD COLUMN ${column} TEXT`,
      );
  const base = "/api/workspaces/:workspaceId/collaborations/:agreementId";
  function canInvite(req: any) {
    const { workspaceId, agreementId } = req.params;
    const { user } = app.requireWorkspace(req, workspaceId, [Role.OWNER]);
    const agreement = aggregates.read(workspaceId, agreementId);
    if (
      agreement.value.members.find((m) => m.userId === user.id)?.role !==
      MemberRole.ORGANIZER
    )
      throw new ApiError(403, "FORBIDDEN", "Agreement organizer required.");
    return { user, agreement, workspaceId, agreementId };
  }
  /** A handover may make the agreement organizer a workspace MEMBER. They can keep an
   * existing named seat usable, but cannot create invitations or gain workspace-owner powers. */
  function canManagePendingSeat(req: any) {
    const { workspaceId, agreementId } = req.params;
    const { user } = app.requireWorkspace(req, workspaceId, [
      Role.OWNER,
      Role.MEMBER,
    ]);
    const agreement = aggregates.read(workspaceId, agreementId);
    if (
      agreement.value.members.find((m) => m.userId === user.id)?.role !==
      MemberRole.ORGANIZER
    )
      throw new ApiError(403, "FORBIDDEN", "Agreement organizer required.");
    return { user, agreement, workspaceId, agreementId };
  }
  function validLink(token: unknown) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new ApiError(
        400,
        "INVALID_INVITATION",
        "Invitation is invalid or expired.",
      );
    const row = store.db
      .prepare(
        "SELECT * FROM fairshare_agreement_invites WHERE hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?",
      )
      .get(digest(token), store.now()) as any;
    if (!row)
      throw new ApiError(
        400,
        "INVALID_INVITATION",
        "Invitation is invalid or expired.",
      );
    const agreement = aggregates.read(row.workspace_id, row.agreement_id);
    const creator = store.db
      .prepare(
        "SELECT u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=?",
      )
      .get(row.workspace_id, row.created_by) as any;
    // A named seat stays valid after its creator hands over organizing: the agreement still
    // names that person. Open links stop working once their creator is no longer the organizer.
    if (
      creator?.role !== Role.OWNER ||
      (!pendingSeat(agreement.value, row.id) &&
        agreement.value.members.find((m) => m.userId === row.created_by)
          ?.role !== MemberRole.ORGANIZER)
    )
      throw new ApiError(
        400,
        "INVALID_INVITATION",
        "The organizer can no longer grant this invitation.",
      );
    // Named people keep their seat after the rules are sent; open links stop at sending.
    if (!pendingSeat(agreement.value, row.id) && rulesEverSent(agreement.value))
      throw new ApiError(
        409,
        "MEMBERS_LOCKED",
        "This agreement has already entered rules review. Ask the organizer for a new draft invitation.",
      );
    return { row, agreement, creator };
  }
  app.post(`${base}/invitation-links`, async (req, reply) => {
    const { user, agreement, workspaceId, agreementId } = canInvite(req);
    store.limit(`agreement-invite:${user.id}`, 30);
    const invitee = parseInvitee(req.body);
    if (rulesEverSent(agreement.value))
      throw new ApiError(
        409,
        "MEMBERS_LOCKED",
        "Invite everyone before sending the rules.",
      );
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      expiresAt = store.now() + INVITE_TTL_MS;
    store.tx(() => {
      store.db
        .prepare(
          "INSERT INTO fairshare_agreement_invites(id,hash,workspace_id,agreement_id,created_by,expires_at,invitee_name,invitee_email,invitee_role) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          digest(token),
          workspaceId,
          agreementId,
          user.id,
          expiresAt,
          invitee?.name ?? null,
          invitee?.email ?? null,
          invitee?.role ?? null,
        );
      store.audit(user.id, workspaceId, "AGREEMENT_INVITATION_CREATED", {
        invitationId: id,
        agreementId,
      });
    });
    reply.header("Cache-Control", "no-store").code(201);
    return {
      invitation: { id, token, expiresAt, invitee },
      agreement: { id: agreementId, name: agreement.value.name },
    };
  });
  app.get(`${base}/invitation-links`, async (req: any, reply) => {
    const { workspaceId, agreementId } = canInvite(req);
    reply.header("Cache-Control", "no-store");
    const now = store.now();
    const rows = store.db
      .prepare(
        `SELECT i.id,i.expires_at,i.accepted_at,i.revoked_at,i.invitee_name,i.invitee_email,i.invitee_role,i.accepted_by,u.name AS accepted_by_name
         FROM fairshare_agreement_invites i LEFT JOIN users u ON u.id=i.accepted_by
         WHERE i.workspace_id=? AND i.agreement_id=? ORDER BY i.rowid DESC`,
      )
      .all(workspaceId, agreementId) as any[];
    return {
      invitations: rows.map((row) => ({
        id: row.id,
        invitee: row.invitee_email
          ? {
              name: row.invitee_name,
              email: row.invitee_email,
              role: row.invitee_role,
            }
          : null,
        expiresAt: row.expires_at,
        status: row.accepted_at
          ? InvitationStatus.ACCEPTED
          : row.revoked_at
            ? InvitationStatus.REVOKED
            : row.expires_at <= now
              ? InvitationStatus.EXPIRED
              : InvitationStatus.PENDING,
        ...(row.accepted_by
          ? {
              acceptedBy: {
                userId: row.accepted_by,
                name: row.accepted_by_name ?? null,
              },
            }
          : {}),
      })),
    };
  });
  app.delete(`${base}/invitation-links/:invitationId`, async (req: any) => {
    const { user, workspaceId, agreementId, agreement } = canInvite(req);
    if (pendingSeat(agreement.value, req.params.invitationId))
      throw new ApiError(
        409,
        "PERSON_IN_AGREEMENT",
        "Remove this person, or replace their link, instead.",
      );
    const result = store.db
      .prepare(
        "UPDATE fairshare_agreement_invites SET revoked_at=? WHERE id=? AND workspace_id=? AND agreement_id=? AND accepted_at IS NULL",
      )
      .run(store.now(), req.params.invitationId, workspaceId, agreementId);
    if (!result.changes)
      throw new ApiError(
        404,
        "NOT_FOUND",
        "Invitation not found or already accepted.",
      );
    store.audit(user.id, workspaceId, "AGREEMENT_INVITATION_REVOKED", {
      invitationId: req.params.invitationId,
      agreementId,
    });
    return { ok: true };
  });
  function insertInvite(
    user: { id: string },
    workspaceId: string,
    agreementId: string,
    invitee: Invitee,
  ) {
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      expiresAt = store.now() + INVITE_TTL_MS;
    store.db
      .prepare(
        "INSERT INTO fairshare_agreement_invites(id,hash,workspace_id,agreement_id,created_by,expires_at,invitee_name,invitee_email,invitee_role) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        digest(token),
        workspaceId,
        agreementId,
        user.id,
        expiresAt,
        invitee.name,
        invitee.email,
        invitee.role,
      );
    store.audit(user.id, workspaceId, "AGREEMENT_INVITATION_CREATED", {
      invitationId: id,
      agreementId,
    });
    return { id, token, expiresAt };
  }
  function revokeInvite(
    user: { id: string },
    workspaceId: string,
    agreementId: string,
    invitationId: string,
  ) {
    const result = store.db
      .prepare(
        "UPDATE fairshare_agreement_invites SET revoked_at=? WHERE id=? AND workspace_id=? AND agreement_id=? AND accepted_at IS NULL AND revoked_at IS NULL",
      )
      .run(store.now(), invitationId, workspaceId, agreementId);
    if (result.changes)
      store.audit(user.id, workspaceId, "AGREEMENT_INVITATION_REVOKED", {
        invitationId,
        agreementId,
      });
  }
  const at = () => new Date(store.now()).toISOString();
  // Name someone the rules can include before they join. Returns their single-use link.
  app.post(`${base}/people`, async (req: any, reply) => {
    const { user, workspaceId, agreementId } = canInvite(req);
    store.limit(`agreement-invite:${user.id}`, 30);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const revision = expectedRevision(b.expectedRevision);
    const invitee = parseInvitee({
      name: b.name,
      email: b.email,
      role: InviteeRole.COLLABORATOR,
    })!;
    const result = store.tx(() => {
      let invitation: { id: string; token: string; expiresAt: number };
      const agreement = aggregates.updateInsideTransaction(
        workspaceId,
        agreementId,
        revision,
        (value) => {
          invitation = insertInvite(user, workspaceId, agreementId, invitee);
          return addPendingMember(
            value,
            {
              invitationId: invitation.id,
              name: invitee.name,
              email: invitee.email,
            },
            user.id,
            at(),
          );
        },
      );
      return { agreement, invitation: invitation! };
    });
    reply.header("Cache-Control", "no-store").code(201);
    return result;
  });
  // Replace a named person's link (lost or expired). Works after sending; the old link stops working.
  app.post(`${base}/people/:userId/invitation`, async (req: any, reply) => {
    const { user, workspaceId, agreementId } = canManagePendingSeat(req);
    store.limit(`agreement-invite:${user.id}`, 30);
    const revision = expectedRevision((req.body ?? {}).expectedRevision);
    const result = store.tx(() => {
      let invitation: { id: string; token: string; expiresAt: number };
      const agreement = aggregates.updateInsideTransaction(
        workspaceId,
        agreementId,
        revision,
        (value) => {
          const seat = value.members.find(
            (m) => m.userId === req.params.userId,
          );
          if (!seat?.pending)
            throw new DomainError(
              "NOT_PENDING",
              "Only people who have not joined need a new link",
            );
          invitation = insertInvite(user, workspaceId, agreementId, {
            name: seat.displayName,
            email: seat.pending.email,
            role: InviteeRole.COLLABORATOR,
          });
          revokeInvite(
            user,
            workspaceId,
            agreementId,
            seat.pending.invitationId,
          );
          return reissuePendingInvite(
            value,
            seat.userId,
            invitation.id,
            user.id,
            at(),
          );
        },
      );
      return { agreement, invitation: invitation! };
    });
    reply.header("Cache-Control", "no-store").code(201);
    return result;
  });
  // Remove someone before the rules are sent; a named person's link is revoked with them.
  app.delete(`${base}/people/:userId`, async (req: any, reply) => {
    const { user, workspaceId, agreementId } = canManagePendingSeat(req);
    const revision = expectedRevision(req.query?.expectedRevision);
    const result = store.tx(() => {
      const agreement = aggregates.updateInsideTransaction(
        workspaceId,
        agreementId,
        revision,
        (value) => {
          const seat = value.members.find(
            (m) => m.userId === req.params.userId,
          );
          const next = removeMember(value, req.params.userId, user.id, at());
          if (seat?.pending)
            revokeInvite(
              user,
              workspaceId,
              agreementId,
              seat.pending.invitationId,
            );
          return next;
        },
      );
      return { agreement };
    });
    reply.header("Cache-Control", "no-store");
    return result;
  });
  // Token-only and signed-out friendly: the link itself is the credential, so this
  // returns just enough to recognise the invite. Accepting still needs a session.
  app.post("/api/agreement-invitations/preview", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    store.limit(`agreement-invite-preview:ip:${digest(req.ip)}`, 60);
    const { row, agreement, creator } = validLink((req.body as any)?.token);
    return {
      agreementName: agreement.value.name,
      inviterName: creator.name,
      expiresAt: row.expires_at,
    };
  });
  app.post("/api/agreement-invitations/accept", async (req, reply) => {
    const user = app.requireSession(req);
    store.limit(`agreement-invite-accept:${user.id}`, 30);
    const result = store.tx(() => {
      const { row, agreement } = validLink((req.body as any)?.token);
      const existing = store.db
        .prepare(
          "SELECT role FROM memberships WHERE workspace_id=? AND user_id=?",
        )
        .get(row.workspace_id, user.id) as any;
      if (existing?.role === Role.VIEWER)
        throw new ApiError(
          403,
          "VIEWER_READ_ONLY",
          "Ask the workspace owner to update your access before joining an agreement.",
        );
      if (!existing)
        store.db
          .prepare("INSERT INTO memberships VALUES(?,?,?)")
          .run(row.workspace_id, user.id, Role.MEMBER);
      const updated = aggregates.updateInsideTransaction(
        row.workspace_id,
        row.agreement_id,
        agreement.revision,
        (value) => {
          if (pendingSeat(value, row.id)) {
            if (value.members.some((m) => m.userId === user.id))
              throw new ApiError(
                409,
                "ALREADY_MEMBER",
                "You are already in this agreement. Ask the organizer to remove the extra invitation.",
              );
            return bindPendingMember(
              value,
              row.id,
              { id: user.id, displayName: user.name },
              new Date(store.now()).toISOString(),
            );
          }
          if (value.members.some((m) => m.userId === user.id)) return value;
          const next = structuredClone(value);
          next.members.push({
            userId: user.id,
            displayName: user.name,
            role: MemberRole.COLLABORATOR,
          });
          return next;
        },
      );
      store.db
        .prepare(
          "UPDATE fairshare_agreement_invites SET accepted_at=?, accepted_by=? WHERE id=?",
        )
        .run(store.now(), user.id, row.id);
      store.audit(user.id, row.workspace_id, "AGREEMENT_INVITATION_ACCEPTED", {
        invitationId: row.id,
        agreementId: row.agreement_id,
      });
      return {
        workspace: store.membership(user.id, row.workspace_id),
        agreement: updated,
      };
    });
    reply.header("Cache-Control", "no-store");
    return result;
  });
  app.get(`${base}/recipient-status`, async (req: any, reply) => {
    reply.header("Cache-Control", "no-store");
    const { user } = app.requireWorkspace(req, req.params.workspaceId);
    const agreement = aggregates.read(
      req.params.workspaceId,
      req.params.agreementId,
    );
    if (!agreement.value.members.some((m) => m.userId === user.id))
      throw new ApiError(404, "NOT_FOUND", "Agreement not found.");
    const configured = !!readPayoutDestination(
      store.db,
      user.id,
      req.params.workspaceId,
    );
    return { configured }; // Self status only; no destination or other person's account is disclosed.
  });
}
