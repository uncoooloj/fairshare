import {
  applyCaptureRefund,
  DomainError,
  RefundKind,
  refundedCents,
  type CapturePayoutState,
} from "@fairshare/domain";
import type { Database } from "./database.js";
import type { AggregateStore } from "./fairshare.js";

const fail = (code: string, message: string): never => {
  throw new DomainError(code, message);
};

const REFUND_OPS_SQL = `CREATE TABLE IF NOT EXISTS fairshare_refund_ops(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,collaboration_id TEXT NOT NULL,payment_id TEXT NOT NULL,capture_id TEXT NOT NULL,amount INTEGER NOT NULL,request_key TEXT NOT NULL UNIQUE,provider_refund_id TEXT UNIQUE,status TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,client_key TEXT NOT NULL,fee_returned INTEGER,applied_at TEXT,settled_by_hold INTEGER NOT NULL DEFAULT 0,UNIQUE(payment_id,client_key))`;
const LEGACY_COLUMNS =
  "id,workspace_id,collaboration_id,payment_id,capture_id,amount,request_key,provider_refund_id,status,created_by,created_at";

/** Refund operations allow several partial refunds per payment. The first version allowed one
 * full refund per payment and capture, and handled a completed one by pausing the agreement
 * instead of reversing the split. Migrated rows keep the "full" client key. A legacy COMPLETED
 * row is marked settled by that pause (applied_at = created_at, settled_by_hold = 1): it is
 * never reversed by the split, it no longer blocks resuming, and since the whole payment went
 * back, that payment's payouts stay stopped. Legacy rows still in flight stay unapplied. */
export function ensureRefundSchema(db: Database, tx: <T>(fn: () => T) => T) {
  tx(() => {
    const existing = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='fairshare_refund_ops'",
      )
      .get() as { sql: string } | undefined;
    if (existing && !existing.sql.includes("client_key")) {
      db.exec(
        "ALTER TABLE fairshare_refund_ops RENAME TO fairshare_refund_ops_v1",
      );
      db.exec(REFUND_OPS_SQL);
      db.exec(
        `INSERT INTO fairshare_refund_ops(${LEGACY_COLUMNS},client_key,applied_at,settled_by_hold) SELECT ${LEGACY_COLUMNS},'full',CASE WHEN status='COMPLETED' THEN created_at END,CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END FROM fairshare_refund_ops_v1`,
      );
      db.exec("DROP TABLE fairshare_refund_ops_v1");
    } else db.exec(REFUND_OPS_SQL);
    db.exec(
      "CREATE TABLE IF NOT EXISTS fairshare_disputes(id TEXT NOT NULL,workspace_id TEXT NOT NULL,collaboration_id TEXT NOT NULL,status TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(id,workspace_id,collaboration_id))",
    );
  });
}

/** A refund operation still moving money: it blocks that payment's payouts and resuming. */
export const UNSETTLED_REFUND_SQL =
  "applied_at IS NULL AND status NOT IN ('FAILED','CANCELLED')";
/** A refund that stops that payment's payouts: still moving money, or a legacy full refund
 * whose money is gone but whose shares were never reversed. */
export const PAYOUT_BLOCKING_REFUND_SQL = `((${UNSETTLED_REFUND_SQL}) OR settled_by_hold=1)`;

/** Payout rows that never reached PayPal and are not reserved for sending. A refund while
 * every row for a payment is in one of these states is a refund "before payouts". */
const UNSENT = [
  "WAITING_RECIPIENT",
  "AUTO_HELD",
  "HELD",
  "CANCELLED_FOR_REFUND",
];
/** PayPal payout outcomes where the money did not reach the person. */
const UNDELIVERED = [
  "FAILED",
  "RETURNED",
  "REFUNDED",
  "REVERSED",
  "BLOCKED",
  "DENIED",
  "CANCELED",
];
type PayoutRow = {
  id: string;
  user_id: string;
  status: string;
  amount: number;
  batch_id: string | null;
  item_id: string | null;
};
const unsent = (r: PayoutRow) =>
  UNSENT.includes(r.status) && r.batch_id === null && r.item_id === null;
/** RESERVED rows are claimed in a later transaction that re-checks holds, so a hold placed
 * first stops them; they count as "payouts started" but not as money paid. */
const mayHaveBeenPaid = (r: PayoutRow) =>
  !unsent(r) &&
  !(r.status === "RESERVED" && r.batch_id === null && r.item_id === null) &&
  !UNDELIVERED.includes(r.status);

const payoutRows = (db: Database, captureId: string) =>
  db
    .prepare(
      "SELECT id,user_id,status,amount,batch_id,item_id FROM fairshare_payout_ops WHERE capture_id=?",
    )
    .all(captureId) as PayoutRow[];

/** Whether a payment's shares are reserved or (maybe) paid, and per person what may be paid. */
export function capturePayoutState(
  db: Database,
  captureId: string,
): CapturePayoutState {
  const rows = payoutRows(db, captureId);
  const paidCents: Record<string, number> = {};
  for (const r of rows)
    if (mayHaveBeenPaid(r))
      Object.defineProperty(paidCents, r.user_id, {
        value: r.amount,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  return { payoutsStarted: rows.some((r) => !unsent(r)), paidCents };
}

/** Call inside a transaction. Applies a provider-verified refund to its payment by the
 * payment's stored split, then lines up unsent payout rows with the new amounts. */
export function applyRefundToCapture(
  db: Database,
  aggregates: AggregateStore,
  input: {
    captureId: string;
    refundId: string;
    kind: RefundKind;
    grossCents: number;
    feeReturnedCents: number;
    at: string;
  },
): { held: boolean; duplicate: boolean } {
  const match = db
    .prepare("SELECT * FROM fairshare_captures WHERE provider_capture_id=?")
    .get(input.captureId) as any;
  if (!match)
    fail("UNKNOWN_CAPTURE", "Refund does not match a recorded payment");
  const row = aggregates.read(match.workspace_id, match.collaboration_id);
  const result = applyCaptureRefund(
    row.value,
    {
      refundId: input.refundId,
      captureId: input.captureId,
      kind: input.kind,
      grossCents: input.grossCents,
      feeReturnedCents: input.feeReturnedCents,
    },
    capturePayoutState(db, input.captureId),
    input.at,
  );
  if (result.duplicate) return { held: result.held, duplicate: true };
  aggregates.updateInsideTransaction(
    match.workspace_id,
    match.collaboration_id,
    row.revision,
    () => result.collaboration,
  );
  const revenue = result.collaboration.revenue.find(
    (r) => r.providerCaptureId === input.captureId,
  )!;
  for (const payout of payoutRows(db, input.captureId)) {
    if (!unsent(payout) || payout.status === "CANCELLED_FOR_REFUND") continue;
    const total =
      revenue.allocations.find((a) => a.userId === payout.user_id)
        ?.totalCents ?? 0;
    if (total <= 0)
      db.prepare(
        "UPDATE fairshare_payout_ops SET status='CANCELLED_FOR_REFUND' WHERE id=?",
      ).run(payout.id);
    else if (payout.amount !== total)
      db.prepare("UPDATE fairshare_payout_ops SET amount=? WHERE id=?").run(
        total,
        payout.id,
      );
  }
  return { held: result.held, duplicate: false };
}

/** Call inside a transaction, after the operation's provider status was stored. Applies a
 * COMPLETED Fairshare-initiated refund exactly once. */
export function applyCompletedRefundOp(
  db: Database,
  aggregates: AggregateStore,
  opId: string,
  result: {
    id: string;
    status: string;
    amountCents: number;
    accounting?: { feeReturnedCents: number };
  },
  at: string,
): { applied: boolean; held: boolean } {
  const op = db
    .prepare("SELECT * FROM fairshare_refund_ops WHERE id=?")
    .get(opId) as any;
  if (result.status !== "COMPLETED" || op.applied_at)
    return { applied: false, held: false };
  if (result.amountCents !== op.amount)
    fail("REFUND_MISMATCH", "Refund amount does not match the request");
  const feeReturned = result.accounting?.feeReturnedCents ?? 0;
  const outcome = applyRefundToCapture(db, aggregates, {
    captureId: op.capture_id,
    refundId: result.id,
    kind: RefundKind.REFUND,
    grossCents: op.amount,
    feeReturnedCents: feeReturned,
    at,
  });
  db.prepare(
    "UPDATE fairshare_refund_ops SET applied_at=?,fee_returned=? WHERE id=?",
  ).run(at, feeReturned, opId);
  return { applied: true, held: outcome.held };
}

/** Gross still unrefunded on a recorded payment. */
export function unrefundedCents(
  aggregates: AggregateStore,
  workspaceId: string,
  collaborationId: string,
  captureId: string,
): number {
  const revenue = aggregates
    .read(workspaceId, collaborationId)
    .value.revenue.find((r) => r.providerCaptureId === captureId);
  if (!revenue) fail("NOT_FOUND", "Payment not found");
  return revenue!.grossCents - refundedCents(revenue!).grossCents;
}

export enum DisputeStatus {
  OPEN = "OPEN",
  RESOLVED = "RESOLVED",
}
/** Track PayPal disputes per agreement so resuming waits for them. A resolved dispute never
 * reopens; a dispute without an ID is keyed by its payments. */
export function recordDispute(
  db: Database,
  action: { eventType: string; disputeId?: string },
  captureIds: string[],
  agreement: { workspace_id: string; collaboration_id: string },
  at: string,
) {
  const id = action.disputeId ?? `captures:${[...captureIds].sort().join(",")}`;
  if (action.eventType === "CUSTOMER.DISPUTE.RESOLVED")
    db.prepare(
      "INSERT INTO fairshare_disputes VALUES(?,?,?,?,?) ON CONFLICT(id,workspace_id,collaboration_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at",
    ).run(
      id,
      agreement.workspace_id,
      agreement.collaboration_id,
      DisputeStatus.RESOLVED,
      at,
    );
  else
    db.prepare(
      "INSERT OR IGNORE INTO fairshare_disputes VALUES(?,?,?,?,?)",
    ).run(
      id,
      agreement.workspace_id,
      agreement.collaboration_id,
      DisputeStatus.OPEN,
      at,
    );
}
export function openDisputeCount(
  db: Database,
  workspaceId: string,
  collaborationId: string,
): number {
  return Number(
    (
      db
        .prepare(
          "SELECT count(*) AS n FROM fairshare_disputes WHERE workspace_id=? AND collaboration_id=? AND status=?",
        )
        .get(workspaceId, collaborationId, DisputeStatus.OPEN) as any
    ).n,
  );
}
