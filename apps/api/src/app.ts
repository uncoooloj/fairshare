import { registerAgreementInvitations } from "./agreementInvitations.js";
import type { DocumentReaders } from "./documentReaders.js";
import type { DatabaseBackend } from "./database.js";
import { registerProfileRoutes } from "./profileRoutes.js";
import { registerPreferences } from "./preferences.js";
import { registerAccountSettings } from "./accountSettings.js";
import { registerAgreementIntake } from "./agreementIntake.js";
import { verifyLocalOcrTools } from "./ocr.js";
import { registerReviewCollaboration } from "./reviewCollaboration.js";
import {
  registerEmailRoutes,
  deliverInvitation,
  type EmailOptions,
} from "./emailRoutes.js";
import { registerPaymentRoutes, type PaymentOptions } from "./paymentRoutes.js";
import { PayPalError } from "@fairshare/payments";
import { registerFairshareRoutes } from "./fairshare.js";
import { DomainError } from "@fairshare/domain";
import type { CloudflareConfig, extractContract } from "@fairshare/contract-ai";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  ApiError,
  DataMode,
  IdentityStore,
  Role,
  digest,
  type User,
} from "./identity.js";
export interface AppOptions extends EmailOptions {
  documentReaders?: DocumentReaders;
  database?: DatabaseBackend;
  hackathonMfaSimulation?: boolean;
  mfaEncryptionKey?: string;
  dbPath?: string;
  clock?: () => number;
  demo?: boolean;
  logger?: boolean;
  localOcrEnabled?: boolean;
  ai?: CloudflareConfig;
  extract?: typeof extractContract;
  payment?: PaymentOptions;
}
export type FairshareApp = FastifyInstance & {
  store: IdentityStore;
  requireSession: (request: FastifyRequest) => User;
  requireWorkspace: (
    request: FastifyRequest,
    workspaceId: string,
    roles?: Role[],
  ) => { user: User; workspace: any };
};
function domainErrorStatus(code: string): number {
  if (code === "PDF_BUSY") return 429;
  if (
    [
      "PARSER_NOT_CONFIGURED",
      "PARSER_UNAVAILABLE",
      "PAYPAL_NOT_CONFIGURED",
      "PAYOUT_NOT_CONFIGURED",
      "CALLBACK_NOT_CONFIGURED",
    ].includes(code)
  )
    return 503;
  if (code === "INVALID_WEBHOOK_SIGNATURE") return 401;
  if (code === "NOT_FOUND") return 404;
  if (code === "FORBIDDEN") return 403;
  if (
    [
      "REVISION_CONFLICT",
      "STALE_VERSION",
      "APPROVALS_REQUIRED",
      "INVALID_STATE",
      "MEMBERS_LOCKED",
      "PENDING_MEMBER",
      "PENDING_MEMBERS",
      "PAYOUT_DESTINATION_CONFLICT",
      "NOT_A_DRAFT",
      "DUPLICATE_PERSON",
      "NOT_PENDING",
      "ALREADY_MEMBER",
      "ADVANCE_RECIPIENT_CHANGED",
      "ADVANCE_BELOW_RECOUPED",
    ].includes(code)
  )
    return 409;
  return 400;
}
export async function buildApp(
  options: AppOptions = {},
): Promise<FairshareApp> {
  if (
    options.payment?.automaticPayoutsEnabled &&
    (options.demo ||
      !options.payment.provider ||
      !options.payment.reconciliation?.enabled)
  )
    throw new Error(
      "Automatic payouts require SANDBOX provider and durable reconciliation",
    );
  if (options.localOcrEnabled && !options.documentReaders)
    await verifyLocalOcrTools();
  if (
    options.payment?.reconciliation?.enabled &&
    (options.demo || !options.payment.provider)
  )
    throw new Error(
      "Reconciliation worker requires configured SANDBOX provider",
    );
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 65536,
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false } },
  }) as unknown as FairshareApp;
  const mode = options.demo ? DataMode.DEMO : DataMode.SANDBOX;
  const store = new IdentityStore(
    options.database ??
      options.dbPath ??
      process.env.DATABASE_PATH ??
      "./data/fairshare-sandbox.db",
    mode,
    options.clock,
    options.mfaEncryptionKey,
    options.hackathonMfaSimulation,
  );
  const bearer = (req: FastifyRequest) => {
    const raw = req.headers.authorization;
    if (!raw?.startsWith("Bearer "))
      throw new ApiError(401, "UNAUTHORIZED", "Sign in to continue.");
    return raw.slice(7);
  };
  app.decorate("store", store);
  app.decorate("requireSession", (req: FastifyRequest) =>
    store.userForToken(bearer(req)),
  );
  app.decorate(
    "requireWorkspace",
    (req: FastifyRequest, id: string, roles?: Role[]) => {
      const user = app.requireSession(req);
      return { user, workspace: store.membership(user.id, id, roles) };
    },
  );
  app.addHook("onClose", async () => store.close());
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof PayPalError)
      return reply
        .status(error.status ?? 502)
        .send({ error: { code: error.code, message: error.code } });
    if (error instanceof DomainError) {
      return reply
        .status(domainErrorStatus(error.code))
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ApiError)
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode < 500
    )
      return reply.status(error.statusCode).send({
        error: { code: "INVALID_REQUEST", message: "Invalid request." },
      });
    request.log.error(error);
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    });
  });
  const assertParticipantAccess = (workspaceId: string, userId: string) => {
    const rows = store.db
      .prepare(
        "SELECT value FROM fairshare_collaborations WHERE workspace_id=?",
      )
      .all(workspaceId) as any[];
    if (
      rows.some((row) =>
        JSON.parse(row.value).members.some((m: any) => m.userId === userId),
      )
    )
      throw new ApiError(
        409,
        "COLLABORATION_MEMBER",
        "Cannot change or remove access while this person belongs to a collaboration.",
      );
  };
  const limit = (req: FastifyRequest, bucket: string, max = 30) =>
    store.limit(`${bucket}:ip:${digest(req.ip)}`, max);
  const objectBody = { type: "object", additionalProperties: false } as const;
  const credentials = {
    ...objectBody,
    required: ["email", "password"],
    properties: {
      email: { type: "string", maxLength: 254 },
      password: { type: "string", maxLength: 256 },
      mfaCode: { type: "string", maxLength: 80 },
    },
  };
  app.get("/api/auth/capabilities", async () => ({
    emailDelivery: !options.demo && Boolean(options.mailTransport),
    invitationDelivery: "LINK",
  }));
  app.get("/health", async () => ({
    status: "ok",
    mode,
    realMoneyEnabled: false,
  }));
  app.post(
    "/api/auth/register",
    {
      schema: {
        body: {
          ...credentials,
          required: ["email", "password", "name"],
          properties: {
            ...credentials.properties,
            name: { type: "string", maxLength: 80 },
          },
        },
      },
    },
    async (req, reply) => {
      limit(req, "register", 10);
      return reply.status(201).send(store.register(req.body as any));
    },
  );
  app.post(
    "/api/auth/login",
    { schema: { body: credentials } },
    async (req) => {
      limit(req, "login", 30);
      const b = req.body as any;
      store.limit(`login:email:${digest(b.email.trim().toLowerCase())}`, 10);
      return store.login(b.email, b.password, b.mfaCode);
    },
  );
  app.post("/api/auth/logout", async (req) => {
    app.requireSession(req);
    store.logout(bearer(req));
    return { ok: true };
  });
  app.get("/api/auth/me", async (req) => ({ user: app.requireSession(req) }));
  app.get("/api/auth/mfa", async (req) =>
    store.mfa.status(app.requireSession(req).id),
  );
  app.post("/api/auth/mfa/setup", async (req) =>
    store.mfa.start(app.requireSession(req).id, (req.body as any)?.password),
  );
  app.post("/api/auth/mfa/cancel", async (req) =>
    store.mfa.cancel(app.requireSession(req).id),
  );
  app.post("/api/auth/mfa/activate", async (req) =>
    store.mfa.activate(app.requireSession(req).id, (req.body as any)?.code),
  );
  app.post("/api/auth/mfa/disable", async (req) => {
    const user = app.requireSession(req),
      body = req.body as any;
    return store.mfa.disable(user.id, body?.password, body?.code);
  });
  app.post(
    "/api/auth/profile",
    {
      schema: {
        body: {
          ...objectBody,
          required: ["name"],
          properties: { name: { type: "string", maxLength: 80 } },
        },
      },
    },
    async (req) => {
      const user = app.requireSession(req);
      limit(req, "profile", 20);
      return {
        user: store.updateProfile(user.id, (req.body as { name: string }).name),
      };
    },
  );
  app.post(
    "/api/auth/password",
    {
      schema: {
        body: {
          ...objectBody,
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string", maxLength: 256 },
            newPassword: { type: "string", maxLength: 256 },
          },
        },
      },
    },
    async (req) => {
      const user = app.requireSession(req);
      limit(req, "password", 10);
      const b = req.body as any;
      store.changePassword(user.id, b.currentPassword, b.newPassword);
      return { ok: true, signInRequired: true };
    },
  );
  app.get("/api/workspaces", async (req) => ({
    workspaces: store.workspaces(app.requireSession(req).id),
  }));
  app.post(
    "/api/workspaces",
    {
      schema: {
        body: {
          ...objectBody,
          required: ["name"],
          properties: { name: { type: "string", maxLength: 100 } },
        },
      },
    },
    async (req, reply) => {
      const user = app.requireSession(req);
      limit(req, "workspace", 20);
      return reply.status(201).send({
        workspace: store.createWorkspace(user.id, (req.body as any).name),
      });
    },
  );
  app.get<{ Params: { id: string } }>("/api/workspaces/:id", async (req) => ({
    workspace: app.requireWorkspace(req, req.params.id).workspace,
  }));
  app.get<{ Params: { id: string } }>(
    "/api/workspaces/:id/members",
    async (req) => {
      app.requireWorkspace(req, req.params.id);
      return {
        members: store.db
          .prepare(
            "SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?",
          )
          .all(req.params.id),
      };
    },
  );
  app.patch<{ Params: { id: string; userId: string } }>(
    "/api/workspaces/:id/members/:userId",
    {
      schema: {
        body: {
          ...objectBody,
          required: ["role"],
          properties: {
            role: { type: "string", enum: [Role.MEMBER, Role.VIEWER] },
          },
        },
      },
    },
    async (req) => {
      const { user } = app.requireWorkspace(req, req.params.id, [Role.OWNER]);
      assertParticipantAccess(req.params.id, req.params.userId);
      return {
        membership: store.changeMemberRole(
          user.id,
          req.params.id,
          req.params.userId,
          (req.body as any).role,
        ),
      };
    },
  );
  app.delete<{ Params: { id: string; userId: string } }>(
    "/api/workspaces/:id/members/:userId",
    async (req) => {
      const { user } = app.requireWorkspace(req, req.params.id, [Role.OWNER]);
      assertParticipantAccess(req.params.id, req.params.userId);
      store.removeMember(user.id, req.params.id, req.params.userId);
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/workspaces/:id/invitations",
    {
      schema: {
        body: {
          ...objectBody,
          required: ["email", "role"],
          properties: {
            email: { type: "string", maxLength: 254 },
            role: { type: "string", enum: [Role.MEMBER, Role.VIEWER] },
          },
        },
      },
    },
    async (req, reply) => {
      const { user } = app.requireWorkspace(req, req.params.id, [Role.OWNER]);
      limit(req, "invite", 30);
      const b = req.body as any;
      return reply
        .status(201)
        .send(await deliverInvitation(app, options, user, req.params.id, b));
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/workspaces/:id/invitation-links",
    {
      schema: {
        body: {
          ...objectBody,
          required: ["role"],
          properties: {
            role: { type: "string", enum: [Role.MEMBER, Role.VIEWER] },
          },
        },
      },
    },
    async (req, reply) => {
      const { user } = app.requireWorkspace(req, req.params.id, [Role.OWNER]);
      limit(req, "invite", 30);
      const invitation = store.createInvitationLink(
        user,
        req.params.id,
        (req.body as { role: string }).role,
      );
      reply.header("Cache-Control", "no-store");
      return reply.status(201).send({
        invitation,
        delivery: "PRIVATE_LINK",
        notice:
          "Private single-use link. Anyone holding it can join this workspace after signing in. Expires in 48 hours. No email is sent.",
      });
    },
  );
  app.delete<{ Params: { id: string; invitationId: string } }>(
    "/api/workspaces/:id/invitations/:invitationId",
    async (req) => {
      const { user } = app.requireWorkspace(req, req.params.id, [Role.OWNER]);
      store.revoke(user.id, req.params.id, req.params.invitationId);
      return { ok: true };
    },
  );
  app.post(
    "/api/invitations/accept",
    {
      schema: {
        body: {
          ...objectBody,
          required: ["token"],
          properties: { token: { type: "string", maxLength: 128 } },
        },
      },
    },
    async (req) => {
      const user = app.requireSession(req);
      limit(req, "accept", 30);
      return { workspace: store.accept(user, (req.body as any).token, true) };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/workspaces/:id/audit",
    async (req) => {
      app.requireWorkspace(req, req.params.id);
      return {
        events: store.db
          .prepare(
            "SELECT id,actor_id AS actorId,action,detail,created_at AS createdAt FROM audit WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100",
          )
          .all(req.params.id)
          .map((row: any) => ({ ...row, detail: JSON.parse(row.detail) })),
      };
    },
  );
  registerPreferences(app);
  registerEmailRoutes(app, options);
  registerProfileRoutes(app, options);
  const domainRoutes = registerFairshareRoutes(app, {
    ai: options.ai,
    extract: options.extract,
    localOcrEnabled: options.localOcrEnabled,
    documentReaders: options.documentReaders,
  });
  registerAgreementIntake(app, domainRoutes.store, {
    localOcrEnabled: options.localOcrEnabled,
    documentReaders: options.documentReaders,
  });
  registerPaymentRoutes(app, domainRoutes.store, options.payment);
  registerReviewCollaboration(app, domainRoutes.store, options);
  registerAccountSettings(app, !!options.payment?.provider);
  registerAgreementInvitations(app, domainRoutes.store);
  return app;
}
