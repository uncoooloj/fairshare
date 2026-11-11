import {
  RecipientType,
  isValidRecipient,
  normalizePayoutEmail,
} from "@fairshare/payments";
import type { FairshareApp } from "./app.js";
import type { Database } from "./database.js";
import { ApiError } from "./identity.js";

/** What other people may learn about someone's payout destination. Never the address. */
export enum PayoutReadiness {
  READY = "READY",
  NEEDS_EMAIL = "NEEDS_EMAIL",
}
export type PayoutDestination = {
  type: RecipientType;
  value: string;
  /** null for a legacy per-workspace PayPal ID saved before account-level emails. */
  updatedAt: number | null;
};
type AccountRow = { type: string; value: string; updatedAt: number };

/** Idempotent startup migration. Additive only: legacy workspace rows and
 * already-frozen payout operations keep their PayPal ID meaning. */
export function ensurePayoutAccountSchema(db: Database) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS fairshare_payout_accounts(user_id TEXT PRIMARY KEY,recipient_type TEXT NOT NULL,receiver TEXT NOT NULL,updated_at INTEGER NOT NULL)",
  );
  const columns = db
    .prepare("PRAGMA table_info(fairshare_payout_ops)")
    .all() as { name: string }[];
  if (columns.length && !columns.some((c) => c.name === "recipient_type"))
    db.exec(
      `ALTER TABLE fairshare_payout_ops ADD COLUMN recipient_type TEXT NOT NULL DEFAULT '${RecipientType.PAYPAL_ID}'`,
    );
}

/** One destination per person. Account-level saves win; a legacy per-workspace
 * PayPal ID is read as a fallback without rewriting it. */
export function readPayoutDestination(
  db: Database,
  userId: string,
  workspaceId?: string,
): PayoutDestination | null {
  const account = db
    .prepare(
      "SELECT recipient_type AS type, receiver AS value, updated_at AS updatedAt FROM fairshare_payout_accounts WHERE user_id=?",
    )
    .get(userId) as AccountRow | undefined;
  if (account && isValidRecipient(account.type, account.value))
    return {
      type: account.type as RecipientType,
      value: account.value,
      updatedAt: account.updatedAt,
    };
  if (!workspaceId) return null;
  const legacy = tableExists(db, "fairshare_recipients")
    ? (db
        .prepare(
          "SELECT paypal_id AS value FROM fairshare_recipients WHERE workspace_id=? AND user_id=?",
        )
        .get(workspaceId, userId) as { value: unknown } | undefined)
    : undefined;
  return legacy && isValidRecipient(RecipientType.PAYPAL_ID, legacy.value)
    ? {
        type: RecipientType.PAYPAL_ID,
        value: legacy.value as string,
        updatedAt: null,
      }
    : null;
}

export function payoutReadiness(
  db: Database,
  userId: string,
  workspaceId: string,
): PayoutReadiness {
  return readPayoutDestination(db, userId, workspaceId)
    ? PayoutReadiness.READY
    : PayoutReadiness.NEEDS_EMAIL;
}

function tableExists(db: Database, name: string) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}

/** Self-only routes. The one place a payout destination is written. */
export function registerPayoutAccountRoutes(app: FairshareApp) {
  const db = app.store.db;
  ensurePayoutAccountSchema(db);
  const path = "/api/auth/payout-account";
  app.get<{ Querystring: { workspaceId?: string } }>(
    path,
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const user = app.requireSession(req);
      const workspaceId = req.query.workspaceId;
      if (workspaceId) app.requireWorkspace(req, workspaceId);
      return {
        destination: readPayoutDestination(db, user.id, workspaceId),
        // A suggestion only: nothing is saved until the person presses Save.
        suggestedEmail: normalizePayoutEmail(user.email),
      };
    },
  );
  app.put(path, async (req) => {
    const user = app.requireSession(req);
    const email = normalizePayoutEmail((req.body as any)?.email);
    if (!email)
      throw new ApiError(
        400,
        "INVALID_PAYOUT_EMAIL",
        "Enter the email you use for PayPal.",
      );
    const updatedAt = app.store.now();
    app.store.tx(() => {
      db.prepare(
        "INSERT INTO fairshare_payout_accounts(user_id,recipient_type,receiver,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET recipient_type=excluded.recipient_type,receiver=excluded.receiver,updated_at=excluded.updated_at",
      ).run(user.id, RecipientType.EMAIL, email, updatedAt);
      app.store.audit(user.id, null, "PAYOUT_ACCOUNT_SAVED");
    });
    return {
      destination: { type: RecipientType.EMAIL, value: email, updatedAt },
    };
  });
  app.delete(path, async (req) => {
    const user = app.requireSession(req);
    app.store.tx(() => {
      db.prepare("DELETE FROM fairshare_payout_accounts WHERE user_id=?").run(
        user.id,
      );
      // Removing is account-wide, so legacy fallbacks must not resurface.
      if (tableExists(db, "fairshare_recipients"))
        db.prepare("DELETE FROM fairshare_recipients WHERE user_id=?").run(
          user.id,
        );
      app.store.audit(user.id, null, "PAYOUT_ACCOUNT_REMOVED");
    });
    return { removed: true };
  });
}
