import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { FairshareApp } from "./app.js";
import type { AggregateStore } from "./fairshare.js";
import { ApiError, DataMode, Role } from "./identity.js";
import { MemberRole } from "@fairshare/domain";
import { MailKind, publicAppOrigin } from "./mail.js";
import type { EmailOptions } from "./emailRoutes.js";

interface ReviewRouteParams {
  workspaceId: string;
  collaborationId: string;
  versionId: string;
}

interface CommentRow {
  sequence: number;
  id: string;
  versionId: number;
  ruleKey: string;
  parentId: string | null;
  authorId: string;
  body: string;
  createdAt: number;
}

interface ParentCommentRow {
  parent_id: string | null;
  rule_key: string;
}

interface ReminderRecipientRow {
  email: string;
  email_verified_at: number | null;
}

interface RecentReminderRow {
  status: string;
  createdAt: number;
}

interface CommentInput {
  body: string;
  ruleKey: string;
  parentId?: string;
}

interface ReminderInput {
  recipientId: string;
}

export function registerReviewCollaboration(
  app: FairshareApp,
  store: AggregateStore,
  options: EmailOptions,
) {
  const db = app.store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS agreement_comments(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,agreement_id TEXT NOT NULL,version_id INTEGER NOT NULL,rule_key TEXT NOT NULL,parent_id TEXT,author_id TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS agreement_comments_scope ON agreement_comments(workspace_id,agreement_id,version_id);
 CREATE TABLE IF NOT EXISTS agreement_reminders(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,agreement_id TEXT NOT NULL,version_id INTEGER NOT NULL,recipient_id TEXT NOT NULL,actor_id TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,created_at INTEGER NOT NULL);`);
  const base =
    "/api/workspaces/:workspaceId/collaborations/:collaborationId/versions/:versionId";
  function access(req: FastifyRequest, write = false) {
    const routeParams = req.params as ReviewRouteParams;
    const { user } = app.requireWorkspace(
      req,
      routeParams.workspaceId,
      write ? [Role.OWNER, Role.MEMBER] : undefined,
    );
    const collaborationRow = store.read(
      routeParams.workspaceId,
      routeParams.collaborationId,
    );
    const collaborationMember = collaborationRow.value.members.find(
      (member) => member.userId === user.id,
    );
    if (!collaborationMember)
      throw new ApiError(403, "FORBIDDEN", "Agreement participants only.");
    if (!/^[1-9]\d{0,8}$/.test(routeParams.versionId))
      throw new ApiError(400, "INVALID_VERSION", "Invalid version.");
    const version = collaborationRow.value.versions.find(
      (version) => version.id === Number(routeParams.versionId),
    );
    if (!version) throw new ApiError(404, "NOT_FOUND", "Version not found.");
    return {
      routeParams,
      user,
      collaborationRow,
      collaborationMember,
      version,
    };
  }
  function listComments(
    routeParams: ReviewRouteParams,
    afterSequence: number,
  ): CommentRow[] {
    return db
      .prepare(
        `SELECT rowid AS sequence,id,version_id AS versionId,rule_key AS ruleKey,parent_id AS parentId,author_id AS authorId,body,created_at AS createdAt FROM agreement_comments WHERE workspace_id=? AND agreement_id=? AND version_id=? AND rowid>? ORDER BY rowid LIMIT 101`,
      )
      .all(
        routeParams.workspaceId,
        routeParams.collaborationId,
        Number(routeParams.versionId),
        afterSequence,
      ) as unknown as CommentRow[];
  }
  function findReplyParent(
    parentId: string,
    routeParams: ReviewRouteParams,
    versionId: number,
  ): ParentCommentRow | undefined {
    return db
      .prepare(
        "SELECT parent_id,rule_key FROM agreement_comments WHERE id=? AND workspace_id=? AND agreement_id=? AND version_id=?",
      )
      .get(
        parentId,
        routeParams.workspaceId,
        routeParams.collaborationId,
        versionId,
      ) as ParentCommentRow | undefined;
  }
  function findReminderRecipient(
    recipientId: string,
    workspaceId: string,
  ): ReminderRecipientRow | undefined {
    return db
      .prepare(
        "SELECT u.email,u.email_verified_at FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.workspace_id=? AND m.role IN (?,?)",
      )
      .get(recipientId, workspaceId, Role.OWNER, Role.MEMBER) as
      | ReminderRecipientRow
      | undefined;
  }
  function reserveReminder(
    routeParams: ReviewRouteParams,
    versionId: number,
    recipientId: string,
    actorId: string,
    reminderId: string,
    createdAt: number,
  ): RecentReminderRow | undefined {
    // Reserve the daily delivery slot before the external mail-provider call.
    return app.store.tx(() => {
      const existingReminder = db
        .prepare(
          "SELECT status,created_at AS createdAt FROM agreement_reminders WHERE workspace_id=? AND agreement_id=? AND version_id=? AND recipient_id=? AND created_at>? ORDER BY created_at DESC LIMIT 1",
        )
        .get(
          routeParams.workspaceId,
          routeParams.collaborationId,
          versionId,
          recipientId,
          createdAt - 86400000,
        ) as RecentReminderRow | undefined;
      if (existingReminder) return existingReminder;
      db.prepare(
        "INSERT INTO agreement_reminders VALUES(?,?,?,?,?,?,?,NULL,?)",
      ).run(
        reminderId,
        routeParams.workspaceId,
        routeParams.collaborationId,
        versionId,
        recipientId,
        actorId,
        "SENDING",
        createdAt,
      );
      return undefined;
    });
  }
  const commentRuleKeys = ["AGREEMENT", "SPLIT", "FEES", "ADVANCE", "SOURCE"];
  app.get(`${base}/comments`, async (req) => {
    const { routeParams } = access(req);
    const query = req.query as { after?: string };
    if (query.after !== undefined && !/^\d{1,15}$/.test(query.after))
      throw new ApiError(400, "INVALID_CURSOR", "Invalid comment cursor.");
    const commentRows = listComments(routeParams, Number(query.after ?? 0));
    const commentPage = commentRows.slice(0, 100);
    return {
      comments: commentPage,
      nextCursor:
        commentRows.length > 100 ? String(commentPage.at(-1)!.sequence) : null,
    };
  });
  app.post(
    `${base}/comments`,
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["body", "ruleKey"],
          properties: {
            body: { type: "string", minLength: 1, maxLength: 2000 },
            ruleKey: { type: "string", enum: commentRuleKeys },
            parentId: { type: "string", maxLength: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const { routeParams, user, version } = access(req, true);
      const commentInput = req.body as CommentInput;
      if (!commentInput.body.trim())
        throw new ApiError(400, "INVALID_COMMENT", "Write a comment first.");
      if (version.status === "SUPERSEDED")
        throw new ApiError(
          409,
          "HISTORICAL_VERSION",
          "Comment on the current version instead.",
        );
      app.store.limit(`comments:${user.id}`, 30);
      app.store.limit(`comments:agreement:${routeParams.collaborationId}`, 200);
      if (commentInput.parentId) {
        const parentComment = findReplyParent(
          commentInput.parentId,
          routeParams,
          version.id,
        );
        if (
          !parentComment ||
          parentComment.parent_id ||
          parentComment.rule_key !== commentInput.ruleKey
        )
          throw new ApiError(
            400,
            "INVALID_PARENT",
            "Reply to a root comment on the same version and rule.",
          );
      }
      const comment = {
        id: randomUUID(),
        versionId: version.id,
        ruleKey: commentInput.ruleKey,
        parentId: commentInput.parentId ?? null,
        authorId: user.id,
        body: commentInput.body.trim(),
        createdAt: app.store.now(),
      };
      app.store.tx(() => {
        db.prepare(
          "INSERT INTO agreement_comments VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          comment.id,
          routeParams.workspaceId,
          routeParams.collaborationId,
          version.id,
          comment.ruleKey,
          comment.parentId,
          user.id,
          comment.body,
          comment.createdAt,
        );
        app.store.audit(
          user.id,
          routeParams.workspaceId,
          "AGREEMENT_COMMENT_ADDED",
          {
            agreementId: routeParams.collaborationId,
            versionId: version.id,
            commentId: comment.id,
          },
        );
      });
      return reply.code(201).send({
        comment,
        notice: "Discussion only. Comments do not change rules or approvals.",
      });
    },
  );
  app.post(
    `${base}/reminders`,
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["recipientId"],
          properties: {
            recipientId: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (req) => {
      const {
        routeParams,
        user,
        collaborationRow,
        collaborationMember,
        version,
      } = access(req, true);
      const { recipientId } = req.body as ReminderInput;
      if (collaborationMember.role !== MemberRole.ORGANIZER)
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Only the agreement organizer can send review reminders.",
        );
      if (
        version.status !== "AWAITING_APPROVAL" ||
        collaborationRow.value.versions.at(-1)?.id !== version.id
      )
        throw new ApiError(
          409,
          "NOT_IN_REVIEW",
          "Only the latest version awaiting approval can be reminded.",
        );
      if (
        recipientId === user.id ||
        !collaborationRow.value.members.some(
          (member) => member.userId === recipientId,
        ) ||
        Object.hasOwn(version.approvals, recipientId)
      )
        throw new ApiError(
          400,
          "INVALID_RECIPIENT",
          "Choose a participant who has not approved this version.",
        );
      if (
        app.store.mode === DataMode.DEMO ||
        !options.mailTransport ||
        !options.publicAppOrigin
      )
        throw new ApiError(
          503,
          "EMAIL_UNAVAILABLE",
          "Review reminder email is not configured for this environment. No email was sent.",
        );
      app.store.requireVerifiedEmail(user.id);
      const reminderRecipient = findReminderRecipient(
        recipientId,
        routeParams.workspaceId,
      );
      if (
        !reminderRecipient ||
        typeof reminderRecipient.email_verified_at !== "number"
      )
        throw new ApiError(
          409,
          "RECIPIENT_UNVERIFIED",
          "The participant must verify their email first.",
        );
      const reminderLink = publicAppOrigin(options.publicAppOrigin) + "/";
      const reminderId = randomUUID(),
        createdAt = app.store.now();
      app.store.limit(`reminders:${user.id}`, 10, 3600000);
      const existingReminder = reserveReminder(
        routeParams,
        version.id,
        recipientId,
        user.id,
        reminderId,
        createdAt,
      );
      if (existingReminder)
        return {
          ...existingReminder,
          repeated: true,
          notice:
            "A reminder was already attempted for this person and version in the last 24 hours. No additional email was sent.",
        };
      try {
        const receipt = await options.mailTransport.send({
          kind: MailKind.AGREEMENT_REVIEW,
          to: reminderRecipient.email,
          link: reminderLink,
          expiresAt: createdAt + 86400000,
          operationId: reminderId,
        });
        if (!receipt.providerId) throw new Error("Missing provider receipt");
        db.prepare(
          "UPDATE agreement_reminders SET status=?,provider_id=? WHERE id=?",
        ).run("PROVIDER_ACCEPTED", receipt.providerId, reminderId);
        app.store.audit(
          user.id,
          routeParams.workspaceId,
          "AGREEMENT_REMINDER_REQUESTED",
          {
            agreementId: routeParams.collaborationId,
            versionId: version.id,
            recipientId,
            reminderId,
          },
        );
        return {
          id: reminderId,
          status: "PROVIDER_ACCEPTED",
          createdAt,
          notice:
            "The email provider accepted the reminder. Inbox delivery is not confirmed.",
        };
      } catch {
        db.prepare("UPDATE agreement_reminders SET status=? WHERE id=?").run(
          "UNCONFIRMED",
          reminderId,
        );
        throw new ApiError(
          503,
          "EMAIL_DELIVERY_UNCONFIRMED",
          "Reminder delivery is unconfirmed. Do not resend; another attempt is blocked for 24 hours to avoid duplicates.",
        );
      }
    },
  );
}
