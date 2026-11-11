import type { FairshareApp } from "./app.js";
import type { IdentityStore } from "./identity.js";
import { ApiError } from "./identity.js";
import type { Collaboration } from "@fairshare/domain";

export const notificationKinds = [
  "approvalRequests",
  "versionChanges",
  "payoutCompleted",
  "payoutFailed",
  "exceptions",
] as const;
type NotificationKind = (typeof notificationKinds)[number];

function notificationKindForAuditEvent(
  type: string,
): NotificationKind | undefined {
  switch (type) {
    case "SENT_FOR_REVIEW":
      return "approvalRequests";
    case "VERSION_PROPOSED":
      return "versionChanges";
    case "PAYMENT_HELD":
      return "exceptions";
  }
}

function notificationMessage(kind: NotificationKind) {
  switch (kind) {
    case "approvalRequests":
      return "An agreement version was sent for approval.";
    case "versionChanges":
      return "A new agreement version is available.";
    case "exceptions":
      return "A payment was put on hold.";
    case "payoutCompleted":
      return "PayPal confirms your sandbox payout succeeded.";
    case "payoutFailed":
      return "";
  }
}

function notificationKindForPayoutStatus(
  status: string,
): NotificationKind | null {
  if (status === "SUCCESS") return "payoutCompleted";
  if (["FAILED", "BLOCKED", "DENIED", "RETURNED", "REFUNDED"].includes(status))
    return "payoutFailed";
  return null;
}

export interface Preferences {
  defaultCurrency: "USD";
  numberFormat: "en-US" | "de-DE" | "fr-FR";
  dateFormat: "medium" | "day-first" | "iso";
  notifications: Record<NotificationKind, { email: boolean; inApp: boolean }>;
}
export function defaultPreferences(): Preferences {
  return {
    defaultCurrency: "USD",
    numberFormat: "en-US",
    dateFormat: "medium",
    notifications: Object.fromEntries(
      notificationKinds.map((kind) => [kind, { email: true, inApp: true }]),
    ) as Preferences["notifications"],
  };
}
export function readPreferences(
  store: IdentityStore,
  userId: string,
): Preferences {
  const row = store.db
    .prepare("SELECT value FROM user_preferences WHERE user_id=?")
    .get(userId) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : defaultPreferences();
}
export function registerPreferences(app: FairshareApp) {
  const { store } = app;
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS user_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,value TEXT NOT NULL)",
  );
  const channels = {
    type: "object",
    additionalProperties: false,
    required: ["email", "inApp"],
    properties: { email: { type: "boolean" }, inApp: { type: "boolean" } },
  };
  app.get("/api/auth/preferences", async (req) => ({
    preferences: readPreferences(store, app.requireSession(req).id),
  }));
  app.put(
    "/api/auth/preferences",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "defaultCurrency",
            "numberFormat",
            "dateFormat",
            "notifications",
          ],
          properties: {
            defaultCurrency: { type: "string", enum: ["USD"] },
            numberFormat: { type: "string", enum: ["en-US", "de-DE", "fr-FR"] },
            dateFormat: {
              type: "string",
              enum: ["medium", "day-first", "iso"],
            },
            notifications: {
              type: "object",
              additionalProperties: false,
              required: [...notificationKinds],
              properties: Object.fromEntries(
                notificationKinds.map((kind) => [kind, channels]),
              ),
            },
          },
        },
      },
    },
    async (req) => {
      const user = app.requireSession(req);
      store.limit(`preferences:${user.id}`, 60);
      store.db
        .prepare(
          "INSERT INTO user_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value",
        )
        .run(user.id, JSON.stringify(req.body));
      return { preferences: readPreferences(store, user.id) };
    },
  );
  // Read actual agreement events and provider-confirmed payout states, never synthetic delivery.
  app.get("/api/auth/notifications", async (req) => {
    const user = app.requireSession(req),
      preferences = readPreferences(store, user.id);
    const rows = store.db
      .prepare(
        "SELECT c.workspace_id,c.value FROM fairshare_collaborations c JOIN memberships m ON m.workspace_id=c.workspace_id WHERE m.user_id=?",
      )
      .all(user.id) as { workspace_id: string; value: string }[];
    const events: {
      id: string;
      kind: NotificationKind;
      workspaceId: string;
      agreementId: string;
      agreementName: string;
      at: string | null;
      message: string;
    }[] = [];
    const agreements = new Map<string, Collaboration>();
    for (const row of rows) {
      const c = JSON.parse(row.value) as Collaboration;
      if (!c.members.some((member) => member.userId === user.id)) continue;
      agreements.set(`${row.workspace_id}:${c.id}`, c);
      for (const event of c.audit) {
        const kind = notificationKindForAuditEvent(event.type);
        if (!kind || !preferences.notifications[kind].inApp) continue;
        // Draft versions are private to the organizer. Notify version changes only once sent.
        const version = c.versions.find(
          (v) => v.id === event.details.versionId,
        );
        if (
          kind === "versionChanges" &&
          (!version || version.status === "DRAFT")
        )
          continue;
        events.push({
          id: `${c.id}:${event.sequence}`,
          kind,
          workspaceId: row.workspace_id,
          agreementId: c.id,
          agreementName: c.name,
          at: event.at,
          message: notificationMessage(kind),
        });
      }
    }
    const payouts = store.db
      .prepare(
        "SELECT id,workspace_id,collaboration_id,status FROM fairshare_payout_ops WHERE user_id=?",
      )
      .all(user.id) as {
      id: string;
      workspace_id: string;
      collaboration_id: string;
      status: string;
    }[];
    for (const payout of payouts) {
      const agreement = agreements.get(
        `${payout.workspace_id}:${payout.collaboration_id}`,
      );
      const kind = notificationKindForPayoutStatus(payout.status);
      if (!agreement || !kind || !preferences.notifications[kind].inApp)
        continue;
      events.push({
        id: `payout:${payout.id}:${payout.status}`,
        kind,
        workspaceId: payout.workspace_id,
        agreementId: agreement.id,
        agreementName: agreement.name,
        at: null,
        message:
          kind === "payoutFailed"
            ? `Your sandbox payout needs attention (${payout.status.toLowerCase()}).`
            : notificationMessage(kind),
      });
    }
    const datedEvents = events
      .filter((event) => event.at !== null)
      .sort((a, b) => b.at!.localeCompare(a.at!) || a.id.localeCompare(b.id));
    const undatedEvents = events
      .filter((event) => event.at === null)
      .sort(
        (a, b) =>
          Number(a.kind !== "payoutFailed") -
            Number(b.kind !== "payoutFailed") || a.id.localeCompare(b.id),
      );
    const visible = [] as typeof events;
    let datedIndex = 0,
      undatedIndex = 0;
    while (
      visible.length < 100 &&
      (datedIndex < datedEvents.length || undatedIndex < undatedEvents.length)
    ) {
      if (datedIndex < datedEvents.length)
        visible.push(datedEvents[datedIndex++]!);
      if (visible.length < 100 && undatedIndex < undatedEvents.length)
        visible.push(undatedEvents[undatedIndex++]!);
    }
    return { events: visible };
  });
}
export function requireApprovalEmail(store: IdentityStore, userId: string) {
  if (!readPreferences(store, userId).notifications.approvalRequests.email) {
    throw new ApiError(
      409,
      "NOTIFICATIONS_DISABLED",
      "This participant has turned off approval-request emails. Share the agreement link instead.",
    );
  }
}
