import type { FairshareApp } from "./app.js";
import { ApiError, Role } from "./identity.js";
import {
  hasAccountPayoutDestination,
  payoutReadiness,
  readPayoutDestination,
  registerPayoutAccountRoutes,
} from "./payoutAccounts.js";

type PaymentAccountMember = { id: string; name: string };
type LegacyPaymentAccountMember = PaymentAccountMember & {
  paypalId: string | null;
};
type ActivityEvent = {
  id: string;
  actorId: string;
  action: string;
  createdAt: number;
  agreementId?: string;
  agreementName?: string;
};
type ActivityAuditRow = ActivityEvent & { detail: string };
type CollaborationRow = { value: string };
type UserNameRow = { id: string; name: string };

/** Payout readiness per workspace member. Destinations are account-level and
 * only their owner ever sees the address; everyone else sees readiness. */
export function registerAccountSettings(
  app: FairshareApp,
  providerConfigured: boolean,
) {
  const db = app.store.db;
  registerPayoutAccountRoutes(app);
  const base = "/api/workspaces/:workspaceId/payment-accounts";
  app.get<{
    Params: { workspaceId: string };
    Querystring: { version?: string };
  }>(base, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { user } = app.requireWorkspace(req, req.params.workspaceId);
    // v2 is an explicit opt-in because v1's member status vocabulary means
    // something different. Keeping the versions separate avoids making cached
    // v1 clients mistake an account-level email for a workspace merchant ID.
    if (req.query.version !== "2") {
      const members = db
        .prepare(
          `SELECT u.id, u.name, r.paypal_id AS paypalId FROM memberships m
          JOIN users u ON u.id=m.user_id LEFT JOIN fairshare_recipients r
          ON r.workspace_id=m.workspace_id AND r.user_id=m.user_id WHERE m.workspace_id=?`,
        )
        .all(req.params.workspaceId) as LegacyPaymentAccountMember[];
      const accountDestinations = new Set(
        members
          .filter((member) => hasAccountPayoutDestination(db, member.id))
          .map((member) => member.id),
      );
      const ownPaypalId = accountDestinations.has(user.id)
        ? null
        : (members.find((m) => m.id === user.id)?.paypalId ?? null);
      return {
        providerConfigured,
        mode: app.store.mode,
        ownPaypalId,
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          status:
            m.paypalId && !accountDestinations.has(m.id)
              ? "SAVED_UNVERIFIED"
              : "MISSING",
          accountHint:
            m.paypalId && !accountDestinations.has(m.id)
              ? `•••• ${m.paypalId.slice(-4)}`
              : null,
        })),
      };
    }
    const members = db
      .prepare(
        "SELECT u.id, u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?",
      )
      .all(req.params.workspaceId) as PaymentAccountMember[];
    return {
      providerConfigured,
      mode: app.store.mode,
      own: readPayoutDestination(db, user.id, req.params.workspaceId),
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        status: payoutReadiness(db, m.id, req.params.workspaceId),
      })),
    };
  });
  // v1 compatibility only. It intentionally remains workspace-scoped and
  // merchant-ID-only; v2 email destinations stay private to their owner.
  app.put<{ Params: { workspaceId: string } }>(`${base}/mine`, async (req) => {
    const { user } = app.requireWorkspace(req, req.params.workspaceId, [
      Role.OWNER,
      Role.MEMBER,
    ]);
    const paypalId = (req.body as any)?.paypalId;
    if (typeof paypalId !== "string" || !/^[A-Z0-9]{13}$/.test(paypalId))
      throw new ApiError(
        400,
        "INVALID_RECIPIENT",
        "Enter your 13-character sandbox PayPal merchant ID.",
      );
    if (hasAccountPayoutDestination(db, user.id))
      throw new ApiError(
        409,
        "PAYOUT_DESTINATION_CONFLICT",
        "Manage your account-level payout destination before using this legacy route.",
      );
    app.store.tx(() => {
      db.prepare(
        "INSERT INTO fairshare_recipients VALUES(?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET paypal_id=excluded.paypal_id",
      ).run(req.params.workspaceId, user.id, paypalId);
      app.store.audit(user.id, req.params.workspaceId, "PAYOUT_ACCOUNT_SAVED");
    });
    return { status: "SAVED_UNVERIFIED" };
  });
  app.delete<{ Params: { workspaceId: string } }>(
    `${base}/mine`,
    async (req) => {
      const { user } = app.requireWorkspace(req, req.params.workspaceId, [
        Role.OWNER,
        Role.MEMBER,
      ]);
      if (hasAccountPayoutDestination(db, user.id))
        throw new ApiError(
          409,
          "PAYOUT_DESTINATION_CONFLICT",
          "Manage your account-level payout destination before using this legacy route.",
        );
      app.store.tx(() => {
        db.prepare(
          "DELETE FROM fairshare_recipients WHERE workspace_id=? AND user_id=?",
        ).run(req.params.workspaceId, user.id);
        app.store.audit(
          user.id,
          req.params.workspaceId,
          "PAYOUT_ACCOUNT_REMOVED",
        );
      });
      return { removed: true };
    },
  );
  app.get<{
    Querystring: {
      workspaceId?: string;
      actorId?: string;
      action?: string;
      agreementId?: string;
      days?: string;
      offset?: string;
    };
  }>("/api/settings/activity", async (req) => {
    const user = app.requireSession(req),
      q = req.query;
    const days = Number(q.days ?? 30),
      offset = Number(q.offset ?? 0);
    if (
      ![0, 7, 30, 90].includes(days) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 100000
    )
      throw new ApiError(
        400,
        "INVALID_FILTER",
        "Choose a valid date range and page.",
      );
    const events: ActivityEvent[] = [];
    if (q.workspaceId) {
      app.requireWorkspace(req, q.workspaceId);
      const rows = db
        .prepare(
          "SELECT id,actor_id AS actorId,action,detail,created_at AS createdAt FROM audit WHERE workspace_id=?",
        )
        .all(q.workspaceId) as ActivityAuditRow[];
      const visibleAgreements = new Map<string, string>();
      const agreements = db
        .prepare(
          "SELECT value FROM fairshare_collaborations WHERE workspace_id=?",
        )
        .all(q.workspaceId) as CollaborationRow[];
      for (const row of agreements) {
        const agreement = JSON.parse(row.value);
        // Match agreement visibility: unrelated members cannot inspect private contract events.
        if (!agreement.members.some((m: any) => m.userId === user.id)) continue;
        visibleAgreements.set(agreement.id, agreement.name);
        for (const event of agreement.audit)
          events.push({
            id: `${agreement.id}:${event.sequence}`,
            actorId: event.actorId,
            action: event.type,
            createdAt: Date.parse(event.at),
            agreementId: agreement.id,
            agreementName: agreement.name,
          });
      }
      for (const row of rows) {
        const { detail, ...event } = row;
        const agreementId = JSON.parse(detail).agreementId;
        if (agreementId && !visibleAgreements.has(agreementId)) continue;
        events.push({
          ...event,
          ...(agreementId
            ? { agreementId, agreementName: visibleAgreements.get(agreementId) }
            : {}),
        });
      }
    }
    events.push(
      ...(db
        .prepare(
          "SELECT id,actor_id AS actorId,action,created_at AS createdAt FROM audit WHERE actor_id=? AND workspace_id IS NULL",
        )
        .all(user.id) as ActivityEvent[]),
    );
    const names = new Map(
      (db.prepare("SELECT id,name FROM users").all() as UserNameRow[]).map(
        (u) => [u.id, u.name],
      ),
    );
    const cutoff = days ? app.store.now() - days * 86400000 : 0;
    const filtered = events
      .filter(
        (e) =>
          e.createdAt >= cutoff &&
          (!q.actorId || e.actorId === q.actorId) &&
          (!q.action || e.action === q.action) &&
          (!q.agreementId || e.agreementId === q.agreementId),
      )
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return {
      events: filtered.slice(offset, offset + 50).map((e) => ({
        ...e,
        actorName:
          names.get(e.actorId) ??
          (e.actorId === "provider" ? "PayPal" : "System"),
      })),
      total: filtered.length,
      nextOffset: offset + 50 < filtered.length ? offset + 50 : null,
      actors: [...new Set(events.map((e) => e.actorId))].map((id) => ({
        id,
        name: names.get(id) ?? (id === "provider" ? "PayPal" : "System"),
      })),
      actions: [...new Set(events.map((e) => e.action))].sort(),
      agreements: [
        ...new Map(
          events
            .filter((e) => e.agreementId)
            .map((e) => [
              e.agreementId,
              { id: e.agreementId, name: e.agreementName },
            ]),
        ).values(),
      ],
    };
  });
}
