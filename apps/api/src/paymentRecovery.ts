import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { DomainError, holdReversedRevenue } from "@fairshare/domain";
import { reconcileCapture, type PayPalSandbox } from "@fairshare/payments";
import type { FairshareApp, AggregateStore } from "./fairshare.js";
import type { PaymentProvider } from "./paymentRoutes.js";
const fail = (code: string, message: string): never => {
  throw new DomainError(code, message);
};
const id = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9._:-]{1,108}$/.test(value)
    ? value
    : fail("INVALID_INPUT", "Valid operation ID required");
const date = () => new Date().toISOString();
interface Context {
  app: FairshareApp;
  aggregates: AggregateStore;
  provider: () => PaymentProvider;
  access: (req: FastifyRequest, organizer?: boolean) => any;
  ownPayment: (req: FastifyRequest) => any;
  applyCapture: (op: any) => Promise<unknown>;
}
/** Evidence-only recovery. Never clears holds, edits allocations, or replays an unknown write. */
export function registerPaymentRecovery({
  app,
  aggregates,
  provider,
  access,
  ownPayment,
  applyCapture,
}: Context) {
  const db = app.store.db,
    tx = <T>(fn: () => T) => app.store.tx(fn),
    base = "/api/workspaces/:workspaceId/collaborations/:collaborationId";
  db.exec(`CREATE TABLE IF NOT EXISTS fairshare_refund_ops(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,collaboration_id TEXT NOT NULL,payment_id TEXT NOT NULL UNIQUE,capture_id TEXT NOT NULL UNIQUE,amount INTEGER NOT NULL,request_key TEXT NOT NULL UNIQUE,provider_refund_id TEXT UNIQUE,status TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS fairshare_recovery_audit(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,collaboration_id TEXT NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL,operation_id TEXT NOT NULL,provider_id TEXT,created_at TEXT NOT NULL);`);
  const audit = (
    ctx: any,
    kind: string,
    operationId: string,
    providerId: string | null,
  ) =>
    db
      .prepare("INSERT INTO fairshare_recovery_audit VALUES(?,?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        ctx.p.workspaceId,
        ctx.p.collaborationId,
        ctx.user.id,
        kind,
        operationId,
        providerId,
        date(),
      );
  const refundProvider = () => {
    const p = provider();
    if (!p.refundCapture || !p.getRefund)
      fail("REFUND_NOT_CONFIGURED", "Sandbox refund provider required");
    return p as PaymentProvider &
      Pick<PayPalSandbox, "refundCapture" | "getRefund">;
  };
  const ownRefund = (req: FastifyRequest) => {
    const ctx = access(req, true);
    const row = db
      .prepare(
        "SELECT * FROM fairshare_refund_ops WHERE id=? AND workspace_id=? AND collaboration_id=?",
      )
      .get(
        id((req.params as any).refundId),
        ctx.p.workspaceId,
        ctx.p.collaborationId,
      ) as any;
    if (!row) fail("NOT_FOUND", "Refund not found");
    return row;
  };
  app.get(`${base}/recovery`, async (req) => {
    const ctx = access(req, true);
    const p = ctx.p;
    return {
      payments: db
        .prepare(
          "SELECT id,status,provider_order_id,provider_capture_id,amount FROM fairshare_payment_ops WHERE workspace_id=? AND collaboration_id=? AND status IN ('CREATING','CAPTURING','OUTCOME_UNKNOWN')",
        )
        .all(p.workspaceId, p.collaborationId),
      payouts: db
        .prepare(
          "SELECT id,status,batch_id,capture_id,user_id,amount FROM fairshare_payout_ops WHERE workspace_id=? AND collaboration_id=? AND status IN ('RESERVED','SUBMITTING','OUTCOME_UNKNOWN','HELD')",
        )
        .all(p.workspaceId, p.collaborationId),
      refunds: db
        .prepare(
          "SELECT id,payment_id,capture_id,amount,provider_refund_id,status FROM fairshare_refund_ops WHERE workspace_id=? AND collaboration_id=?",
        )
        .all(p.workspaceId, p.collaborationId),
      audit: db
        .prepare(
          "SELECT actor_id,kind,operation_id,provider_id,created_at FROM fairshare_recovery_audit WHERE workspace_id=? AND collaboration_id=? ORDER BY rowid DESC LIMIT 100",
        )
        .all(p.workspaceId, p.collaborationId),
      notice:
        "Recovery verifies provider evidence only. It does not clear holds or retry uncertain payments.",
    };
  });
  app.post(`${base}/payments/:paymentId/recover`, async (req) => {
    const op = ownPayment(req),
      orderId = id((req.body as any)?.providerOrderId);
    if (op.provider_order_id && op.provider_order_id !== orderId)
      fail("RECOVERY_CONFLICT", "Order already linked");
    const verified = await reconcileCapture(provider(), {
      orderId,
      reference: op.id,
      amountCents: op.amount,
      currency: "USD",
      ...(op.provider_capture_id ? { captureId: op.provider_capture_id } : {}),
    });
    if (!verified.confirmed || !verified.capture)
      fail(
        "RECOVERY_NOT_CONFIRMED",
        "Only a completed, reference-matched capture can recover an unknown order",
      );
    const capture = verified.capture!;
    tx(() => {
      const ctx = access(req, true);
      const fresh = ownPayment(req);
      if (fresh.provider_order_id && fresh.provider_order_id !== orderId)
        fail("RECOVERY_CONFLICT", "Order already linked");
      const other = db
        .prepare(
          "SELECT id FROM fairshare_payment_ops WHERE provider_order_id=? OR provider_capture_id=?",
        )
        .all(orderId, capture.id) as any[];
      if (other.some((r) => r.id !== op.id))
        fail("RECOVERY_CONFLICT", "Provider payment already linked");
      db.prepare(
        "UPDATE fairshare_payment_ops SET provider_order_id=?,provider_capture_id=? WHERE id=?",
      ).run(orderId, capture.id, op.id);
      audit(ctx, "ORDER_EVIDENCE_LINKED", op.id, orderId);
    });
    return applyCapture({
      ...op,
      provider_order_id: orderId,
      provider_capture_id: capture.id,
    });
  });
  app.post(`${base}/payouts/:payoutId/recover`, async (req) => {
    const ctx = access(req, true),
      p = ctx.p,
      payoutId = id((req.params as any).payoutId),
      batchId = id((req.body as any)?.providerBatchId);
    const read = () =>
      db
        .prepare(
          "SELECT * FROM fairshare_payout_ops WHERE id=? AND workspace_id=? AND collaboration_id=?",
        )
        .get(payoutId, p.workspaceId, p.collaborationId) as any;
    const op = read();
    if (!op) fail("NOT_FOUND", "Payout not found");
    if (op.batch_id && op.batch_id !== batchId)
      fail("RECOVERY_CONFLICT", "Payout already linked");
    const verified = await provider().getPayout(batchId, {
      requestId: op.id,
      recipientId: op.recipient_id,
      amountCents: op.amount,
      currency: "USD",
    });
    return tx(() => {
      const latest = access(req, true),
        fresh = read();
      if (!fresh || (fresh.batch_id && fresh.batch_id !== batchId))
        fail("RECOVERY_CONFLICT", "Payout already linked");
      if (
        db
          .prepare(
            "SELECT id FROM fairshare_payout_ops WHERE batch_id=? AND id<>?",
          )
          .get(batchId, payoutId)
      )
        fail("RECOVERY_CONFLICT", "Provider batch already linked");
      db.prepare(
        "UPDATE fairshare_payout_ops SET batch_id=?,item_id=?,status=? WHERE id=?",
      ).run(batchId, verified.itemId, verified.status, payoutId);
      audit(latest, "PAYOUT_EVIDENCE_LINKED", payoutId, batchId);
      return {
        id: payoutId,
        batchId,
        itemId: verified.itemId,
        status: verified.status,
      };
    });
  });
  const verifyRefund = async (
    req: FastifyRequest,
    op: any,
    refundId: string,
  ) => {
    const result = await refundProvider().getRefund(refundId);
    if (
      result.id !== refundId ||
      result.amountCents !== op.amount ||
      result.currency !== "USD" ||
      result.captureId !== op.capture_id ||
      result.reference !== op.request_key
    )
      fail(
        "REFUND_MISMATCH",
        "Refund does not match reserved capture, amount and request",
      );
    return tx(() => {
      const ctx = access(req, true);
      const fresh = db
        .prepare("SELECT * FROM fairshare_refund_ops WHERE id=?")
        .get(op.id) as any;
      if (fresh.provider_refund_id && fresh.provider_refund_id !== refundId)
        fail("RECOVERY_CONFLICT", "Refund already linked");
      if (fresh.status === "COMPLETED" && result.status !== "COMPLETED")
        fail(
          "REFUND_STATUS_CONFLICT",
          "Completed refund changed state; hold remains",
        );
      const other = db
        .prepare(
          "SELECT id FROM fairshare_refund_ops WHERE provider_refund_id=? AND id<>?",
        )
        .get(refundId, op.id);
      if (other) fail("RECOVERY_CONFLICT", "Refund already linked");
      db.prepare(
        "UPDATE fairshare_refund_ops SET provider_refund_id=?,status=? WHERE id=?",
      ).run(refundId, result.status, op.id);
      audit(ctx, "REFUND_EVIDENCE_VERIFIED", op.id, refundId);
      return {
        id: op.id,
        status: result.status,
        amountCents: op.amount,
        providerRefundId: refundId,
        holdRemains: true,
      };
    });
  };
  app.post(`${base}/payments/:paymentId/refund`, async (req) => {
    const ctx = access(req, true),
      op = ownPayment(req);
    const input = req.body as any;
    if (input?.confirmFullRefund !== true)
      fail(
        "CONFIRMATION_REQUIRED",
        "Explicit full sandbox refund confirmation required",
      );
    if (input.amountCents !== undefined || input.recipientId !== undefined)
      fail("INVALID_INPUT", "Refund amount and recipient cannot be overridden");
    const p = refundProvider();
    const reservation = tx(() => {
      const latest = access(req, true),
        fresh = ownPayment(req);
      const prior = db
        .prepare("SELECT * FROM fairshare_refund_ops WHERE payment_id=?")
        .get(op.id) as any;
      if (prior) return { created: false, op: prior };
      if (fresh.status !== "ALLOCATED" || !fresh.provider_capture_id)
        fail("REFUND_NOT_READY", "Verified allocated capture required");
      if (
        db
          .prepare(
            "SELECT id FROM fairshare_payout_ops WHERE capture_id=? LIMIT 1",
          )
          .get(fresh.provider_capture_id)
      )
        fail(
          "REFUND_AFTER_PAYOUT_UNSUPPORTED",
          "A payout was reserved; operator liability review is required",
        );
      const row = aggregates.read(ctx.p.workspaceId, ctx.p.collaborationId);
      if (row.value.reviewHold)
        fail("PAYMENT_HOLD", "Resolve existing hold before a new refund");
      const refundId = randomUUID(),
        key = `refund-${refundId}`;
      aggregates.updateInsideTransaction(
        ctx.p.workspaceId,
        ctx.p.collaborationId,
        row.revision,
        (c) =>
          holdReversedRevenue(
            c,
            fresh.provider_capture_id,
            "Full original-capture refund requested; liabilities retained pending review",
            date(),
          ),
      );
      db.prepare(
        "INSERT INTO fairshare_refund_ops VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        refundId,
        ctx.p.workspaceId,
        ctx.p.collaborationId,
        op.id,
        fresh.provider_capture_id,
        fresh.amount,
        key,
        null,
        "SUBMITTING",
        latest.user.id,
        date(),
      );
      audit(
        latest,
        "FULL_REFUND_RESERVED",
        refundId,
        fresh.provider_capture_id,
      );
      return {
        created: true,
        op: db
          .prepare("SELECT * FROM fairshare_refund_ops WHERE id=?")
          .get(refundId) as any,
      };
    });
    if (!reservation.created)
      return {
        id: reservation.op.id,
        status: reservation.op.status,
        amountCents: reservation.op.amount,
        providerRefundId: reservation.op.provider_refund_id,
        holdRemains: true,
      };
    const refund = reservation.op;
    let result;
    try {
      result = await p.refundCapture(
        refund.capture_id,
        refund.amount,
        "USD",
        refund.request_key,
      );
    } catch {
      db.prepare(
        "UPDATE fairshare_refund_ops SET status='OUTCOME_UNKNOWN' WHERE id=?",
      ).run(refund.id);
      return { id: refund.id, status: "OUTCOME_UNKNOWN", holdRemains: true };
    }
    // Preserve a known provider identifier even if access was revoked during the external write.
    if (
      !result.id ||
      result.amountCents !== refund.amount ||
      result.currency !== "USD"
    ) {
      db.prepare(
        "UPDATE fairshare_refund_ops SET status='OUTCOME_UNKNOWN' WHERE id=?",
      ).run(refund.id);
      fail("REFUND_MISMATCH", "Provider result requires investigation");
    }
    db.prepare(
      "UPDATE fairshare_refund_ops SET provider_refund_id=?,status='PENDING' WHERE id=?",
    ).run(result.id, refund.id);
    access(req, true);
    return verifyRefund(req, refund, result.id);
  });
  app.post(`${base}/refunds/:refundId/reconcile`, async (req) => {
    const op = ownRefund(req);
    if (!op.provider_refund_id)
      fail(
        "REFUND_OUTCOME_UNKNOWN",
        "Provide provider refund evidence to recover this operation",
      );
    return verifyRefund(req, op, op.provider_refund_id);
  });
  app.post(`${base}/refunds/:refundId/recover`, async (req) => {
    const op = ownRefund(req),
      refundId = id((req.body as any)?.providerRefundId);
    if (op.provider_refund_id && op.provider_refund_id !== refundId)
      fail("RECOVERY_CONFLICT", "Refund already linked");
    return verifyRefund(req, op, refundId);
  });
}
