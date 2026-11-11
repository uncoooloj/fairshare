import { randomBytes, randomUUID } from "node:crypto";
import { MemberRole } from "@fairshare/domain";
import type { FairshareApp } from "./app.js";
import type { AggregateStore } from "./fairshare.js";
import { ApiError, digest, Role } from "./identity.js";

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

/** Agreement links grant workspace membership AND a draft roster seat, never approval. */
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
    if (
      creator?.role !== Role.OWNER ||
      agreement.value.members.find((m) => m.userId === row.created_by)?.role !==
        MemberRole.ORGANIZER
    )
      throw new ApiError(
        400,
        "INVALID_INVITATION",
        "The organizer can no longer grant this invitation.",
      );
    if (agreement.value.versions.length)
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
    if (agreement.value.versions.length)
      throw new ApiError(
        409,
        "MEMBERS_LOCKED",
        "Invite everyone before drafting rules.",
      );
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      expiresAt = store.now() + 48 * 3600000;
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
    const { user, workspaceId, agreementId } = canInvite(req);
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
  app.post("/api/agreement-invitations/preview", async (req, reply) => {
    const user = app.requireSession(req);
    store.limit(`agreement-invite-preview:${user.id}`, 60);
    const { row, agreement, creator } = validLink((req.body as any)?.token);
    reply.header("Cache-Control", "no-store");
    return {
      agreementName: agreement.value.name,
      inviterName: creator.name,
      expiresAt: row.expires_at,
      scope: "WORKSPACE_AND_AGREEMENT",
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
    const configured = !!store.db
      .prepare(
        "SELECT 1 FROM fairshare_recipients WHERE workspace_id=? AND user_id=?",
      )
      .get(req.params.workspaceId, user.id);
    return { configured }; // Self status only; no destination or other person's account is disclosed.
  });
}
