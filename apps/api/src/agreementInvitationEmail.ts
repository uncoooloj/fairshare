import { MemberRole } from "@fairshare/domain";
import type { FairshareApp } from "./app.js";
import type { AggregateStore } from "./fairshare.js";
import type { EmailOptions } from "./emailRoutes.js";
import {
  ApiError,
  DataMode,
  digest,
  Role,
  type IdentityStore,
} from "./identity.js";
import { emailDeliveryOrigin, emailLink, MailKind } from "./mail.js";
import { requireApprovalEmail } from "./preferences.js";

const notices: Record<string, string> = {
  PROVIDER_ACCEPTED:
    "The email provider accepted this invitation. Inbox delivery is not confirmed.",
  SENDING:
    "This invitation email is already being processed. No additional email was sent.",
  UNCONFIRMED:
    "Email delivery is unconfirmed. Do not resend this invitation; share its existing link directly or check the provider dashboard.",
};

/** Email attempts bind named links to the intended account, without claiming mailbox
 * verification. Ordinary deliberately shared bearer links keep their existing behavior. */
export function requireEmailedInviteRecipient(
  store: IdentityStore,
  invitation: { id: string; invitee_email?: string | null },
  email: string,
) {
  const table = store.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agreement_invitation_email'",
    )
    .get();
  if (!table) return;
  const sent = store.db
    .prepare(
      "SELECT invitation_id FROM agreement_invitation_email WHERE invitation_id=?",
    )
    .get(invitation.id);
  if (sent && invitation.invitee_email?.toLowerCase() !== email.toLowerCase())
    throw new ApiError(
      403,
      "INVITATION_EMAIL_MISMATCH",
      "Sign in with the email address this invitation was sent to, then open the link again.",
    );
}

/** Explicit user action only. No background sends, automatic retries or raw-token storage. */
export function registerAgreementInvitationEmail(
  app: FairshareApp,
  aggregates: AggregateStore,
  options: EmailOptions,
) {
  const store = app.store;
  store.db.exec(`CREATE TABLE IF NOT EXISTS agreement_invitation_email(
    invitation_id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL,
    provider_id TEXT);`);
  app.post(
    "/api/workspaces/:workspaceId/collaborations/:agreementId/people/:userId/invitation-email",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: {
            token: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
          },
        },
      },
    },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const { workspaceId, agreementId, userId } = req.params as {
        workspaceId: string;
        agreementId: string;
        userId: string;
      };
      const { user } = app.requireWorkspace(req, workspaceId, [
        Role.OWNER,
        Role.MEMBER,
      ]);
      const agreement = aggregates.read(workspaceId, agreementId);
      if (
        agreement.value.members.find((m) => m.userId === user.id)?.role !==
        MemberRole.ORGANIZER
      )
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Only the agreement organizer can email invitations.",
        );
      if (store.mode === DataMode.DEMO || !options.mailTransport)
        throw new ApiError(
          503,
          "EMAIL_UNAVAILABLE",
          "Invitation email is not configured. Share the link directly instead.",
        );
      store.requireVerifiedEmail(user.id);
      const origin = emailDeliveryOrigin(options.publicAppOrigin);
      const member = agreement.value.members.find((m) => m.userId === userId);
      if (!member?.pending)
        throw new ApiError(
          409,
          "NOT_PENDING",
          "Only people who have not joined need an invitation email.",
        );
      const { token } = req.body as { token: string };
      const invitation = store.db
        .prepare(
          `SELECT i.id,i.invitee_email,i.expires_at FROM fairshare_agreement_invites i
      JOIN memberships creator ON creator.workspace_id=i.workspace_id AND creator.user_id=i.created_by
      WHERE i.id=? AND i.hash=? AND i.workspace_id=? AND i.agreement_id=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>?
      AND creator.role IN ('OWNER','MEMBER')`,
        )
        .get(
          member.pending.invitationId,
          digest(token),
          workspaceId,
          agreementId,
          store.now(),
        ) as
        | { id: string; invitee_email: string; expires_at: number }
        | undefined;
      if (!invitation || invitation.invitee_email !== member.pending.email)
        throw new ApiError(
          400,
          "INVALID_INVITATION",
          "This invitation link is invalid or expired. Make a new link from the People tab.",
        );
      const existing = store.db
        .prepare(
          "SELECT status FROM agreement_invitation_email WHERE invitation_id=?",
        )
        .get(invitation.id) as { status: string } | undefined;
      if (existing)
        return {
          status: existing.status,
          repeated: true,
          notice: notices[existing.status],
        };
      const recipient = store.db
        .prepare("SELECT id FROM users WHERE email=?")
        .get(invitation.invitee_email) as { id: string } | undefined;
      if (recipient) requireApprovalEmail(store, recipient.id);
      store.limit(`invitation-email:actor:${user.id}`, 10, 3600000);
      store.limit(
        `invitation-email:recipient:${digest(invitation.invitee_email)}`,
        3,
        86400000,
      );
      // Reservation is durable and synchronous before awaiting the provider. A process
      // interruption leaves SENDING and cannot cause a second send after a restart.
      store.db
        .prepare(
          "INSERT INTO agreement_invitation_email(invitation_id,status,created_at) VALUES(?,?,?)",
        )
        .run(invitation.id, "SENDING", store.now());
      try {
        const receipt = await options.mailTransport.send({
          kind: MailKind.AGREEMENT_INVITATION,
          to: invitation.invitee_email,
          link: emailLink(
            origin,
            MailKind.AGREEMENT_INVITATION,
            `agreement:${token}`,
          ),
          expiresAt: invitation.expires_at,
          operationId: `agreement-invitation:${invitation.id}`,
          agreementName: agreement.value.name,
          inviterName: user.name,
        });
        if (!receipt.providerId) throw new Error("Missing receipt");
        store.db
          .prepare(
            "UPDATE agreement_invitation_email SET status=?,provider_id=? WHERE invitation_id=?",
          )
          .run("PROVIDER_ACCEPTED", receipt.providerId, invitation.id);
        store.audit(
          user.id,
          workspaceId,
          "AGREEMENT_INVITATION_EMAIL_REQUESTED",
          { agreementId, invitationId: invitation.id },
        );
        return {
          status: "PROVIDER_ACCEPTED",
          notice: notices.PROVIDER_ACCEPTED,
        };
      } catch {
        store.db
          .prepare(
            "UPDATE agreement_invitation_email SET status=? WHERE invitation_id=?",
          )
          .run("UNCONFIRMED", invitation.id);
        throw new ApiError(
          503,
          "EMAIL_DELIVERY_UNCONFIRMED",
          notices.UNCONFIRMED!,
        );
      }
    },
  );
}
