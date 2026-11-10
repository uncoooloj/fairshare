import type { FairshareApp } from "./app.js";
import { ApiError, Role } from "./identity.js";

/** Workspace-scoped payout destinations, never OAuth credentials or verified accounts. */
export function registerAccountSettings(
  app: FairshareApp,
  providerConfigured: boolean,
) {
  const db = app.store.db;
  const base = "/api/workspaces/:workspaceId/payment-accounts";
  app.get<{ Params: { workspaceId: string } }>(base, async (req) => {
    const { user } = app.requireWorkspace(req, req.params.workspaceId);
    const members = db
      .prepare(
        `SELECT u.id, u.name, r.paypal_id AS paypalId FROM memberships m
      JOIN users u ON u.id=m.user_id LEFT JOIN fairshare_recipients r
      ON r.workspace_id=m.workspace_id AND r.user_id=m.user_id WHERE m.workspace_id=?`,
      )
      .all(req.params.workspaceId) as any[];
    return {
      providerConfigured,
      mode: app.store.mode,
      ownPaypalId: members.find((m) => m.id === user.id)?.paypalId ?? null,
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        status: m.paypalId ? "SAVED_UNVERIFIED" : "MISSING",
        accountHint: m.paypalId ? `•••• ${m.paypalId.slice(-4)}` : null,
      })),
    };
  });
  app.put<{ Params: { workspaceId: string } }>(`${base}/mine`, async (req) => {
    const { user } = app.requireWorkspace(req, req.params.workspaceId, [
      Role.OWNER,
      Role.MEMBER,
    ]);
    const id = (req.body as any)?.paypalId;
    if (typeof id !== "string" || !/^[A-Z0-9]{13}$/.test(id))
      throw new ApiError(
        400,
        "INVALID_RECIPIENT",
        "Enter your 13-character sandbox PayPal merchant ID.",
      );
    app.store.tx(() => {
      db.prepare(
        "INSERT INTO fairshare_recipients VALUES(?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET paypal_id=excluded.paypal_id",
      ).run(req.params.workspaceId, user.id, id);
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
    const events: any[] = [];
    if (q.workspaceId) {
      app.requireWorkspace(req, q.workspaceId);
      const rows = db
        .prepare(
          "SELECT id,actor_id AS actorId,action,detail,created_at AS createdAt FROM audit WHERE workspace_id=?",
        )
        .all(q.workspaceId) as any[];
      const visibleAgreements = new Map<string, string>();
      const agreements = db
        .prepare(
          "SELECT value FROM fairshare_collaborations WHERE workspace_id=?",
        )
        .all(q.workspaceId) as any[];
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
      ...db
        .prepare(
          "SELECT id,actor_id AS actorId,action,created_at AS createdAt FROM audit WHERE actor_id=? AND workspace_id IS NULL",
        )
        .all(user.id),
    );
    const names = new Map(
      (db.prepare("SELECT id,name FROM users").all() as any[]).map((u) => [
        u.id,
        u.name,
      ]),
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
