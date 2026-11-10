import { randomUUID } from "node:crypto";
import type { FairshareApp } from "./app.js";
import { ApiError, DataMode, digest } from "./identity.js";
import {
  emailDeliveryOrigin,
  emailLink,
  publicAppOrigin,
  MailKind,
  type MailTransport,
} from "./mail.js";
export interface EmailOptions {
  mailTransport?: MailTransport;
  publicAppOrigin?: string;
}
export function registerEmailRoutes(app: FairshareApp, options: EmailOptions) {
  const demo = app.store.mode === DataMode.DEMO,
    origin =
      !demo && options.mailTransport
        ? emailDeliveryOrigin(options.publicAppOrigin)
        : publicAppOrigin(options.publicAppOrigin ?? "http://localhost:3000");
  app.post(
    "/api/auth/verification/request",
    { schema: { body: { type: "object", additionalProperties: false } } },
    async (req) => {
      const user = app.requireSession(req);
      app.store.limit(`verify:user:${user.id}`, 3, 30 * 60000);
      app.store.limit(`verify:ip:${digest(req.ip)}`, 20, 30 * 60000);
      if (user.emailVerified) return { status: "ALREADY_VERIFIED" };
      if (!demo && !options.mailTransport)
        throw new ApiError(
          503,
          "EMAIL_UNAVAILABLE",
          "Email delivery is not configured. No verification email was sent.",
        );
      const proof = app.store.createEmailVerification(user.id);
      const link = emailLink(origin, MailKind.VERIFY_EMAIL, proof.token);
      if (demo)
        return {
          status: "DEMO_ONLY",
          demoVerificationLink: link,
          expiresAt: proof.expiresAt,
          notice:
            "Synthetic demo only. No email was sent. This is not proof of mailbox ownership.",
        };
      try {
        await options.mailTransport!.send({
          kind: MailKind.VERIFY_EMAIL,
          to: proof.email,
          link,
          expiresAt: proof.expiresAt,
          operationId: randomUUID(),
        });
      } catch {
        app.store.invalidateEmailVerification(proof.token);
        throw new ApiError(
          503,
          "EMAIL_DELIVERY_FAILED",
          "Email delivery could not be confirmed. Request a new verification link.",
        );
      }
      app.store.audit(user.id, null, "VERIFICATION_EMAIL_REQUESTED");
      return { status: "EMAIL_REQUESTED", expiresAt: proof.expiresAt };
    },
  );
  app.post(
    "/api/auth/verification/confirm",
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
    async (req) => {
      const user = app.requireSession(req);
      app.store.limit(`confirm:user:${user.id}`, 20, 15 * 60000);
      return {
        user: app.store.confirmEmail(
          user.id,
          (req.body as { token: string }).token,
        ),
        verificationMode: demo ? "DEMO_SIMULATION" : "EMAIL_LINK",
      };
    },
  );
}
export async function deliverInvitation(
  app: FairshareApp,
  options: EmailOptions,
  user: ReturnType<FairshareApp["requireSession"]>,
  workspaceId: string,
  input: { email: string; role: string },
) {
  const demo = app.store.mode === DataMode.DEMO;
  if (!demo) {
    app.store.requireVerifiedEmail(user.id);
    if (!options.mailTransport)
      throw new ApiError(
        503,
        "EMAIL_UNAVAILABLE",
        "Invitation delivery is not configured. No invitation was sent.",
      );
  }
  const invitation = app.store.invite(
    user,
    workspaceId,
    input.email,
    input.role,
  );
  const link = emailLink(
    options.publicAppOrigin ?? "http://localhost:3000",
    MailKind.WORKSPACE_INVITATION,
    invitation.token,
  );
  if (demo)
    return {
      invitation,
      delivery: "DEMO_ONLY",
      demoInvitationLink: link,
      notice:
        "Synthetic demo invitation. No email was sent; do not use with real identities.",
    };
  try {
    await options.mailTransport!.send({
      kind: MailKind.WORKSPACE_INVITATION,
      to: invitation.email,
      link,
      expiresAt: invitation.expiresAt,
      workspaceName: app.store.membership(user.id, workspaceId).name,
      operationId: invitation.id,
    });
  } catch {
    app.store.revoke(user.id, workspaceId, invitation.id);
    throw new ApiError(
      503,
      "EMAIL_DELIVERY_FAILED",
      "Invitation delivery could not be confirmed. The invitation has been revoked; create a new one.",
    );
  }
  const { token: _token, ...safe } = invitation;
  return {
    invitation: safe,
    delivery: "EMAIL_REQUESTED",
    notice:
      "Invitation accepted by the email provider. Delivery is not yet confirmed.",
  };
}
