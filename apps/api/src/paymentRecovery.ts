import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { DomainError, resumePayouts } from "@fairshare/domain";
import { reconcileCapture, type PayPalSandbox } from "@fairshare/payments";
import type { FairshareApp, AggregateStore } from "./fairshare.js";
import type { PaymentProvider } from "./paymentRoutes.js";
import {
  webhookBelongsOnlyTo,
  pendingWebhookBlocksPayout,
} from "./paymentSafety.js";
import {
  applyCompletedRefundOp,
  capturePayoutState,
  ensureRefundSchema,
  openDisputeCount,
  unrefundedCents,
  UNSETTLED_REFUND_SQL,
} from "./refundReversal.js";
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
  processEvent?: (eventId: string) => Promise<void>;
}
/** Where an organizer refund stands for the people in the agreement. */
export enum RefundOutcome {
  /** PayPal confirmed it and it came back out of that payment's split. */
  REVERSED_BY_SPLIT = "REVERSED_BY_SPLIT",
  /** PayPal confirmed it and payouts are paused for the organizer to review. */
  PAUSED_FOR_REVIEW = "PAUSED_FOR_REVIEW",
  /** Not confirmed yet; that payment's payouts wait. */
  WAITING_FOR_PAYPAL = "WAITING_FOR_PAYPAL",
  NOT_REFUNDED = "NOT_REFUNDED",
}
/** Why payouts cannot resume yet. */
export enum ResumeBlocker {
  DISPUTE_OPEN = "DISPUTE_OPEN",
  WEBHOOK_UNRECONCILED = "WEBHOOK_UNRECONCILED",
  REFUND_UNRECONCILED = "REFUND_UNRECONCILED",
}
const resumeBlockerMessages: Record<ResumeBlocker, string> = {
  [ResumeBlocker.DISPUTE_OPEN]:
    "A PayPal dispute on this agreement is still open. Resume once it's closed.",
  [ResumeBlocker.WEBHOOK_UNRECONCILED]:
    "PayPal sent an update that hasn't been checked yet. Check it first.",
  [ResumeBlocker.REFUND_UNRECONCILED]:
    "A refund is still going through. Check its status first.",
};
const clientKey = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)
    ? value
    : fail("INVALID_INPUT", "requestKey required");
/** Evidence-only recovery, plus refunds and resuming after a refund. Never replays an unknown write. */
export function registerPaymentRecovery({
  app,
  aggregates,
  provider,
  access,
  ownPayment,
  applyCapture,
  processEvent,
}: Context) {
  const db = app.store.db,
    tx = <T>(fn: () => T) => app.store.tx(fn),
    base = "/api/workspaces/:workspaceId/collaborations/:collaborationId";
  ensureRefundSchema(db, tx);
  db.exec(
    `CREATE TABLE IF NOT EXISTS fairshare_recovery_audit(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,collaboration_id TEXT NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL,operation_id TEXT NOT NULL,provider_id TEXT,created_at TEXT NOT NULL);`,
  );
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
  const scopedEvents = (p: any) =>
    db
      .prepare(
        "SELECT id,action,status,error FROM fairshare_webhook_inbox WHERE status='PENDING'",
      )
      .all()
      .filter((event) => {
        try {
          return webhookBelongsOnlyTo(db, JSON.parse(event.action), {
            workspace_id: p.workspaceId,
            collaboration_id: p.collaborationId,
          });
        } catch {
          return false;
        }
      });
  const resumeBlockers = (p: any): ResumeBlocker[] => [
    ...(openDisputeCount(db, p.workspaceId, p.collaborationId)
      ? [ResumeBlocker.DISPUTE_OPEN]
      : []),
    ...(pendingWebhookBlocksPayout(db, {
      workspace_id: p.workspaceId,
      collaboration_id: p.collaborationId,
      provider_capture_id: "",
    })
      ? [ResumeBlocker.WEBHOOK_UNRECONCILED]
      : []),
    ...(db
      .prepare(
        `SELECT id FROM fairshare_refund_ops WHERE workspace_id=? AND collaboration_id=? AND ${UNSETTLED_REFUND_SQL} LIMIT 1`,
      )
      .get(p.workspaceId, p.collaborationId)
      ? [ResumeBlocker.REFUND_UNRECONCILED]
      : []),
  ];
  const refundOutcome = (ctx: any, op: any): RefundOutcome => {
    if (["FAILED", "CANCELLED"].includes(op.status))
      return RefundOutcome.NOT_REFUNDED;
    if (!op.applied_at) return RefundOutcome.WAITING_FOR_PAYPAL;
    if (op.settled_by_hold) return RefundOutcome.PAUSED_FOR_REVIEW;
    const applied = aggregates
      .read(ctx.p.workspaceId, ctx.p.collaborationId)
      .value.revenue.find((r) => r.providerCaptureId === op.capture_id)
      ?.refunds?.find((r) => r.id === op.provider_refund_id);
    return applied?.held
      ? RefundOutcome.PAUSED_FOR_REVIEW
      : RefundOutcome.REVERSED_BY_SPLIT;
  };
  app.get(`${base}/recovery`, async (req) => {
    const ctx = access(req, true);
    const p = ctx.p;
    const agreement = ctx.row.value;
    return {
      review: {
        paused: !!agreement.reviewHold,
        offsetActive: !!agreement.offsetOwedBack,
        owed: Object.entries(agreement.owedBack ?? {})
          .filter(([, cents]) => (cents as number) > 0)
          .map(([userId, cents]) => ({
            userId,
            name:
              agreement.members.find((m: any) => m.userId === userId)
                ?.displayName ?? "Someone",
            cents,
          })),
        blockers: resumeBlockers(p),
      },
      events: scopedEvents(p).map((event) => ({
        id: event.id,
        eventType: JSON.parse(event.action).eventType,
        status: event.status,
        error: event.error,
      })),
      providerHold: pendingWebhookBlocksPayout(db, {
        workspace_id: p.workspaceId,
        collaboration_id: p.collaborationId,
        provider_capture_id: "",
      }),
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
          "SELECT id,payment_id,capture_id,amount,provider_refund_id,status,fee_returned,applied_at,settled_by_hold FROM fairshare_refund_ops WHERE workspace_id=? AND collaboration_id=? ORDER BY created_at,rowid",
        )
        .all(p.workspaceId, p.collaborationId),
      audit: db
        .prepare(
          "SELECT actor_id,kind,operation_id,provider_id,created_at FROM fairshare_recovery_audit WHERE workspace_id=? AND collaboration_id=? ORDER BY rowid DESC LIMIT 100",
        )
        .all(p.workspaceId, p.collaborationId),
      notice:
        "Checking with PayPal never clears a pause or retries an uncertain payment.",
    };
  });
  app.post(`${base}/recovery/events/:eventId/reconcile`, async (req) => {
    const ctx = access(req, true);
    const eventId = id((req.params as any).eventId);
    if (!processEvent)
      fail("RECOVERY_UNAVAILABLE", "Provider event recovery is not configured");
    if (!scopedEvents(ctx.p).some((event) => event.id === eventId))
      fail("NOT_FOUND", "Recoverable event not found in this agreement");
    audit(ctx, "WEBHOOK_RECONCILIATION_REQUESTED", eventId, null);
    await processEvent!(eventId);
    access(req, true);
    const event = db
      .prepare("SELECT status,error FROM fairshare_webhook_inbox WHERE id=?")
      .get(eventId);
    return {
      id: eventId,
      status: event.status,
      error: event.error,
      notice:
        "Provider evidence was checked. Existing liability holds are never cleared by this action.",
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
      recipientType: op.recipient_type,
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
      if (
        ["COMPLETED", "FAILED", "CANCELLED"].includes(fresh.status) &&
        fresh.status !== result.status
      )
        fail(
          "REFUND_STATUS_CONFLICT",
          "Terminal refund status changed; hold remains",
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
      if (applyCompletedRefundOp(db, aggregates, op.id, result, date()).applied)
        audit(ctx, "REFUND_APPLIED_TO_SPLIT", op.id, refundId);
      return refundView(ctx, op.id);
    });
  };
  const refundView = (ctx: any, opId: string) => {
    const op = db
      .prepare("SELECT * FROM fairshare_refund_ops WHERE id=?")
      .get(opId) as any;
    return {
      id: op.id,
      status: op.status,
      amountCents: op.amount,
      providerRefundId: op.provider_refund_id,
      outcome: refundOutcome(ctx, op),
      holdRemains: !!aggregates.read(ctx.p.workspaceId, ctx.p.collaborationId)
        .value.reviewHold,
    };
  };
  /** Refund all or part of a payment before any of it is paid out. Fairshare reserves the refund
   * first, which stops that payment's payouts, then asks PayPal. When PayPal confirms, the refund
   * comes back out of that payment's split. Once a share is reserved or paid, refunds are made in
   * PayPal and arrive as a provider refund, which pauses payouts for review. */
  app.post(`${base}/payments/:paymentId/refund`, async (req) => {
    const ctx = access(req, true),
      op = ownPayment(req);
    const input = (req.body ?? {}) as any;
    const full = input.confirmFullRefund === true;
    if (!full && input.confirmRefund !== true)
      fail("CONFIRMATION_REQUIRED", "Confirm the refund first");
    if (input.recipientId !== undefined)
      fail("INVALID_INPUT", "Refunds always go back to whoever paid");
    if (full && input.amountCents !== undefined)
      fail("INVALID_INPUT", "A full refund has no amount");
    if (
      !full &&
      (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1)
    )
      fail("INVALID_MONEY", "Refund amount must be whole cents above zero");
    const key =
      full && input.requestKey === undefined
        ? "full"
        : clientKey(input.requestKey);
    const p = refundProvider();
    const reservation = tx(() => {
      const latest = access(req, true),
        fresh = ownPayment(req);
      const prior = db
        .prepare(
          "SELECT * FROM fairshare_refund_ops WHERE payment_id=? AND client_key=?",
        )
        .get(op.id, key) as any;
      if (prior) {
        if (!full && prior.amount !== input.amountCents)
          fail(
            "IDEMPOTENCY_CONFLICT",
            "Request key reused with a different refund",
          );
        return { created: false, op: prior };
      }
      if (fresh.status !== "ALLOCATED" || !fresh.provider_capture_id)
        fail("REFUND_NOT_READY", "Verified allocated capture required");
      if (
        db
          .prepare(
            "SELECT id FROM fairshare_refund_ops WHERE payment_id=? AND settled_by_hold=1",
          )
          .get(op.id)
      )
        fail(
          "REFUND_EXCEEDS_PAYMENT",
          "This payment was already refunded in full.",
        );
      // Reserved counts as started: a dispatcher may claim it at any moment.
      if (capturePayoutState(db, fresh.provider_capture_id).payoutsStarted)
        fail(
          "REFUND_AFTER_PAYOUT_UNSUPPORTED",
          "Part of this payment was already paid out, so it can't be refunded here.",
        );
      const row = aggregates.read(ctx.p.workspaceId, ctx.p.collaborationId);
      if (
        row.value.reviewHold ||
        pendingWebhookBlocksPayout(db, {
          workspace_id: ctx.p.workspaceId,
          collaboration_id: ctx.p.collaborationId,
          provider_capture_id: fresh.provider_capture_id,
        })
      )
        fail("PAYMENT_HOLD", "Resolve existing hold before a new refund");
      if (
        db
          .prepare(
            `SELECT id FROM fairshare_refund_ops WHERE capture_id=? AND ${UNSETTLED_REFUND_SQL} LIMIT 1`,
          )
          .get(fresh.provider_capture_id)
      )
        fail(
          "REFUND_IN_PROGRESS",
          "Another refund on this payment is still going through",
        );
      const left = unrefundedCents(
        aggregates,
        ctx.p.workspaceId,
        ctx.p.collaborationId,
        fresh.provider_capture_id,
      );
      const amount = full ? left : (input.amountCents as number);
      if (amount < 1 || amount > left)
        fail(
          "REFUND_EXCEEDS_PAYMENT",
          `You can refund up to $${(left / 100).toFixed(2)} of this payment.`,
        );
      const refundId = randomUUID(),
        requestKey = `refund-${refundId}`;
      db.prepare(
        "INSERT INTO fairshare_refund_ops(id,workspace_id,collaboration_id,payment_id,capture_id,amount,request_key,provider_refund_id,status,created_by,created_at,client_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        refundId,
        ctx.p.workspaceId,
        ctx.p.collaborationId,
        op.id,
        fresh.provider_capture_id,
        amount,
        requestKey,
        null,
        "SUBMITTING",
        latest.user.id,
        date(),
        key,
      );
      // The unsettled refund row is the reservation: payoutHoldReason stops this payment's
      // payouts from here until PayPal settles it. A dispatcher that reserved first fails above.
      audit(
        latest,
        amount === left ? "FULL_REFUND_RESERVED" : "PARTIAL_REFUND_RESERVED",
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
    if (!reservation.created) return refundView(ctx, reservation.op.id);
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
      return refundView(ctx, refund.id);
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
  /** Organizer clears the pause after reviewing a refund. Refused while PayPal still has
   * something open. offsetFromFuturePayouts keeps each person's overpayment back from their
   * next shares until settled; without it, owed amounts are recorded as settled outside. */
  app.post(`${base}/payments/resume`, async (req) => {
    const b = req.body as any;
    if (!b || typeof b !== "object" || Array.isArray(b))
      fail("INVALID_INPUT", "JSON object required");
    if (!Number.isSafeInteger(b.expectedRevision) || b.expectedRevision < 1)
      fail("INVALID_INPUT", "expectedRevision required");
    const offset = b.offsetFromFuturePayouts ?? false;
    if (typeof offset !== "boolean")
      fail("INVALID_INPUT", "offsetFromFuturePayouts must be true or false");
    if (b.note !== undefined && typeof b.note !== "string")
      fail("INVALID_INPUT", "Note must be text");
    return tx(() => {
      const ctx = access(req, true),
        p = ctx.p;
      const blocker = resumeBlockers(p)[0];
      if (blocker) fail(blocker, resumeBlockerMessages[blocker]);
      const updated = aggregates.updateInsideTransaction(
        p.workspaceId,
        p.collaborationId,
        b.expectedRevision,
        (c) =>
          resumePayouts(
            c,
            { offsetFromFuturePayouts: offset, note: b.note },
            ctx.user.id,
            date(),
          ),
      );
      // Payouts a pause stopped before PayPal go back to waiting, at what the split now says.
      const held = db
        .prepare(
          "SELECT id,capture_id,user_id FROM fairshare_payout_ops WHERE workspace_id=? AND collaboration_id=? AND status='HELD' AND batch_id IS NULL AND item_id IS NULL",
        )
        .all(p.workspaceId, p.collaborationId) as any[];
      for (const payout of held) {
        const total =
          updated.value.revenue
            .find((r) => r.providerCaptureId === payout.capture_id)
            ?.allocations.find((a) => a.userId === payout.user_id)
            ?.totalCents ?? 0;
        if (total > 0)
          db.prepare(
            "UPDATE fairshare_payout_ops SET status='AUTO_HELD',amount=? WHERE id=?",
          ).run(total, payout.id);
        else
          db.prepare(
            "UPDATE fairshare_payout_ops SET status='CANCELLED_FOR_REFUND' WHERE id=?",
          ).run(payout.id);
      }
      audit(
        ctx,
        offset ? "PAYOUTS_RESUMED_WITH_OFFSET" : "PAYOUTS_RESUMED",
        `${p.collaborationId}:${updated.revision}`,
        null,
      );
      return updated;
    });
  });
  app.post(`${base}/refunds/:refundId/recover`, async (req) => {
    const op = ownRefund(req),
      refundId = id((req.body as any)?.providerRefundId);
    if (op.provider_refund_id && op.provider_refund_id !== refundId)
      fail("RECOVERY_CONFLICT", "Refund already linked");
    return verifyRefund(req, op, refundId);
  });
}
