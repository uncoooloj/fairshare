import {
  registerInvoiceRoutes,
  type InvoiceProvider,
} from "./invoiceRoutes.js";
import { automaticPayouts } from "./automaticPayouts.js";
import { paymentSource } from "./paymentSource.js";
import { createReconciliationWorker } from "./reconciliationWorker.js";
import { randomUUID, createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
  allocateConfirmedRevenue,
  holdReversedRevenue,
  DomainError,
  MemberRole,
  RefundKind,
} from "@fairshare/domain";
import {
  PayPalSandbox,
  PayPalError,
  verifyAndPlanWebhook,
  canRepairRefundPlan,
  canRepairUnsupportedPlan,
  reconcileCapture,
  WebhookActionKind,
  RecipientType,
} from "@fairshare/payments";
import { AggregateStore } from "./fairshare.js";
import type { FairshareApp } from "./app.js";
import { Role } from "./identity.js";
import { registerPaymentRecovery } from "./paymentRecovery.js";
import {
  applyRefundToCapture,
  applyReversal,
  settleRefundOp,
  notePayoutStatus,
  recordDispute,
} from "./refundReversal.js";
import {
  advancePayoutAccountGeneration,
  ensurePayoutAccountSchema,
  hasAccountPayoutDestination,
  readPayoutDestination,
} from "./payoutAccounts.js";
import {
  PARKED_PAYOUT_STATUSES,
  payoutHoldMessages,
  payoutHoldReason,
  PayoutHoldReason,
} from "./payoutHolds.js";

/** Why a person's payout was not sent by a manual dispatch. */
export enum PayoutWaitReason {
  NEEDS_PAYOUT_EMAIL = "NEEDS_PAYOUT_EMAIL",
  ON_HOLD = "ON_HOLD",
}
function payoutWaitReason(status: string): PayoutWaitReason | undefined {
  if (status === "WAITING_RECIPIENT")
    return PayoutWaitReason.NEEDS_PAYOUT_EMAIL;
  if (status === "HELD" || status === "AUTO_HELD")
    return PayoutWaitReason.ON_HOLD;
  return undefined;
}
export type PaymentProvider = Pick<
  PayPalSandbox,
  | "createOrder"
  | "captureOrder"
  | "getOrder"
  | "createPayout"
  | "getPayout"
  | "verifyWebhook"
> &
  Partial<
    Pick<
      PayPalSandbox,
      "refundCapture" | "getRefund" | "webhookConfigured" | "payoutsReady"
    >
  > &
  Partial<InvoiceProvider>;
export interface PaymentOptions {
  provider?: PaymentProvider;
  publicOrigin?: string;
  automaticPayoutsEnabled?: boolean;
  /** Receives one configuration error per process. Never passed secrets. */
  onConfigurationError?: (code: string, message: string) => void;
  reconciliation?: {
    enabled: boolean;
    intervalMs?: number;
    externalScheduling?: boolean;
  };
}
const fail = (code: string, message: string): never => {
  throw new DomainError(code, message);
};
const str = (v: unknown) =>
  typeof v === "string" && v.length > 0 && v.length <= 128
    ? v
    : fail("INVALID_INPUT", "Bounded nonempty string required");
const now = () => new Date().toISOString();
/** Whether PayPal can tell Fairshare a payment or payout went through. */
export enum PaymentConfirmation {
  READY = "READY",
  WEBHOOK_NOT_CONFIGURED = "WEBHOOK_NOT_CONFIGURED",
  NOT_CONFIGURED = "NOT_CONFIGURED",
}
export const WEBHOOK_NOT_CONFIGURED_MESSAGE =
  "PAYPAL_WEBHOOK_ID is not set. Every PayPal webhook is rejected with 503 until it is configured, so payments and payouts can't be confirmed automatically.";
export function registerPaymentRoutes(
  app: FairshareApp,
  aggregates: AggregateStore,
  options: PaymentOptions = {},
) {
  const db = app.store.db,
    tx = <T>(f: () => T) => app.store.tx(f);
  const base = "/api/workspaces/:workspaceId/collaborations/:collaborationId";
  db.exec(`CREATE TABLE IF NOT EXISTS fairshare_payment_ops(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,collaboration_id TEXT NOT NULL,request_key TEXT NOT NULL,version_id INTEGER NOT NULL,amount INTEGER NOT NULL,provider_order_id TEXT UNIQUE,provider_capture_id TEXT UNIQUE,status TEXT NOT NULL,approval_url TEXT,UNIQUE(workspace_id,request_key));
 CREATE TABLE IF NOT EXISTS fairshare_webhook_inbox(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,action TEXT NOT NULL,status TEXT NOT NULL,error TEXT);
 CREATE TABLE IF NOT EXISTS fairshare_recipients(workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,paypal_id TEXT NOT NULL,PRIMARY KEY(workspace_id,user_id));
 CREATE TABLE IF NOT EXISTS fairshare_payout_ops(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,collaboration_id TEXT NOT NULL,capture_id TEXT NOT NULL,user_id TEXT NOT NULL,recipient_id TEXT NOT NULL,amount INTEGER NOT NULL,batch_id TEXT,status TEXT NOT NULL,item_id TEXT,UNIQUE(capture_id,user_id));`);
  ensurePayoutAccountSchema(db);
  // Additive migration: existing checkouts retain their original PayPal attribution.
  for (const [name, definition] of [
    ["source_type", "TEXT NOT NULL DEFAULT 'PAYPAL'"],
    ["source_name", "TEXT NOT NULL DEFAULT 'PayPal'"],
  ]) {
    if (
      !(
        db.prepare("PRAGMA table_info(fairshare_payment_ops)").all() as any[]
      ).some((c) => c.name === name)
    )
      db.exec(
        `ALTER TABLE fairshare_payment_ops ADD COLUMN ${name} ${definition}`,
      );
  }
  const provider = () =>
    options.provider ??
    fail("PAYPAL_NOT_CONFIGURED", "Sandbox provider is not configured");
  let webhookErrorReported = false;
  function reportWebhookNotConfigured() {
    if (webhookErrorReported) return;
    webhookErrorReported = true;
    (
      options.onConfigurationError ??
      ((code, message) =>
        console.error(`payments_configuration_error ${code}: ${message}`))
    )("PAYPAL_WEBHOOK_NOT_CONFIGURED", WEBHOOK_NOT_CONFIGURED_MESSAGE);
  }
  function paymentConfirmation() {
    if (!options.provider) return PaymentConfirmation.NOT_CONFIGURED;
    return options.provider.webhookConfigured === false
      ? PaymentConfirmation.WEBHOOK_NOT_CONFIGURED
      : PaymentConfirmation.READY;
  }
  // Adapters without this optional capability predate setup readiness reporting;
  // their createPayout implementation remains the capability contract.
  function payoutsReady() {
    const configured = options.provider;
    return configured ? configured.payoutsReady !== false : false;
  }
  if (paymentConfirmation() === PaymentConfirmation.WEBHOOK_NOT_CONFIGURED)
    reportWebhookNotConfigured();
  function access(req: FastifyRequest, organizer = false) {
    const p = req.params as any;
    const { user } = app.requireWorkspace(
      req,
      p.workspaceId,
      req.method === "GET" ? undefined : [Role.OWNER, Role.MEMBER],
    );
    const row = aggregates.read(p.workspaceId, p.collaborationId);
    const member = row.value.members.find((m) => m.userId === user.id);
    if (!member || (organizer && member.role !== MemberRole.ORGANIZER))
      fail("FORBIDDEN", "Collaboration access denied");
    return { p, user, row };
  }
  function payment(id: string) {
    const row = db
      .prepare("SELECT * FROM fairshare_payment_ops WHERE id=?")
      .get(id) as any;
    return row ?? fail("NOT_FOUND", "Payment not found");
  }
  function ownPayment(req: FastifyRequest) {
    const ctx = access(req, true);
    const op = payment(str((req.params as any).paymentId));
    if (
      op.workspace_id !== ctx.p.workspaceId ||
      op.collaboration_id !== ctx.p.collaborationId
    )
      fail("NOT_FOUND", "Payment not found");
    return op;
  }
  function paymentError(e: unknown): never {
    throw e;
  }
  async function applyCapture(op: any, assertLease: () => void = () => {}) {
    if (!op.provider_order_id)
      fail("PAYMENT_OUTCOME_UNKNOWN", "Order requires reconciliation");
    let result;
    try {
      result = await reconcileCapture(provider(), {
        orderId: op.provider_order_id,
        reference: op.id,
        amountCents: op.amount,
        currency: "USD",
        ...(op.provider_capture_id
          ? { captureId: op.provider_capture_id }
          : {}),
      });
    } catch (e) {
      paymentError(e);
    }
    if (!result!.confirmed) return { confirmed: false, status: result!.status };
    const capture = result!.capture;

    if (!capture.accounting)
      fail(
        "CAPTURE_ACCOUNTING_REQUIRED",
        "Provider fee accounting must be verified before allocation",
      );
    assertLease();
    return tx(() => {
      const adverse = (
        db
          .prepare(
            "SELECT action FROM fairshare_webhook_inbox WHERE status='PENDING'",
          )
          .all() as any[]
      )
        .map((r) => JSON.parse(r.action))
        .some(
          (a) =>
            a.kind === WebhookActionKind.HoldCapture &&
            (a.providerId === capture.id ||
              a.providerIds?.includes(capture.id)),
        );
      if (adverse)
        fail(
          "PAYMENT_HOLD",
          "An adverse provider event arrived before allocation",
        );
      const fresh = payment(op.id);
      const row = aggregates.read(op.workspace_id, op.collaboration_id);
      if (fresh.status === "ALLOCATED")
        return { confirmed: true, payment: fresh };
      if (row.value.activeVersionId !== op.version_id)
        fail(
          "PAYMENT_RULES_CHANGED",
          "Payment is held for reconciliation because its rules version changed",
        );
      const existing = db
        .prepare("SELECT * FROM fairshare_captures WHERE provider_capture_id=?")
        .get(capture.id) as any;
      if (
        existing &&
        (existing.workspace_id !== op.workspace_id ||
          existing.collaboration_id !== op.collaboration_id)
      )
        fail(
          "CAPTURE_ALREADY_USED",
          "Provider capture belongs to another collaboration",
        );
      aggregates.updateInsideTransaction(
        op.workspace_id,
        op.collaboration_id,
        row.revision,
        (c) =>
          allocateConfirmedRevenue(
            c,
            {
              providerCaptureId: capture.id,
              currency: "USD",
              grossCents: capture.amountCents,
              feeCents: capture.accounting!.feeCents,
            },
            now(),
          ),
      );
      db.prepare("INSERT OR IGNORE INTO fairshare_captures VALUES(?,?,?)").run(
        capture.id,
        op.workspace_id,
        op.collaboration_id,
      );
      db.prepare(
        "UPDATE fairshare_payment_ops SET provider_capture_id=?,status='ALLOCATED' WHERE id=?",
      ).run(capture.id, op.id);
      return { confirmed: true, payment: payment(op.id) };
    });
  }
  app.get(`${base}/payments`, async (req) => {
    const { p } = access(req);
    return {
      payments: [
        ...db
          .prepare(
            "SELECT * FROM fairshare_payment_ops WHERE workspace_id=? AND collaboration_id=?",
          )
          .all(p.workspaceId, p.collaborationId),
        ...invoices.paymentRecords(p.workspaceId, p.collaborationId),
      ],
    };
  });
  app.post(`${base}/payments`, async (req) => {
    const { p, row } = access(req, true);
    const b = req.body as any;
    const key = str(b?.requestKey);
    const source = paymentSource(b?.source);
    if (
      !Number.isSafeInteger(b?.amountCents) ||
      b.amountCents < 1 ||
      b.amountCents > 1_000_000
    )
      fail("INVALID_MONEY", "Sandbox checkout supports 1 to 1000000 cents");
    if (!options.publicOrigin)
      fail("CALLBACK_NOT_CONFIGURED", "HTTPS callback origin required");
    const origin = new URL(options.publicOrigin!);
    if (origin.protocol !== "https:" || origin.username || origin.password)
      fail("CALLBACK_NOT_CONFIGURED", "HTTPS callback origin required");
    provider();
    const reservation = tx(() => {
      const prior = db
        .prepare(
          "SELECT * FROM fairshare_payment_ops WHERE workspace_id=? AND request_key=?",
        )
        .get(p.workspaceId, key) as any;
      if (prior) {
        if (
          prior.collaboration_id !== p.collaborationId ||
          prior.amount !== b.amountCents ||
          prior.source_type !== source.type ||
          prior.source_name !== source.name
        )
          fail(
            "IDEMPOTENCY_CONFLICT",
            "Request key reused with different payment",
          );
        return { op: prior, created: false };
      }
      const current = aggregates.read(p.workspaceId, p.collaborationId);
      if (current.value.reviewHold || !current.value.activeVersionId)
        fail("PAYMENT_HOLD", "Active approved rules and no hold required");
      const id = randomUUID();
      db.prepare(
        "INSERT INTO fairshare_payment_ops(id,workspace_id,collaboration_id,request_key,version_id,amount,status,source_type,source_name) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        p.workspaceId,
        p.collaborationId,
        key,
        current.value.activeVersionId!,
        b.amountCents,
        "CREATING",
        source.type,
        source.name,
      );
      return { op: payment(id), created: true };
    });
    if (!reservation.created) return reservation.op;
    const op = reservation.op;
    try {
      const order = await provider().createOrder({
        amountCents: op.amount,
        currency: "USD",
        reference: op.id,
        requestId: op.id,
        returnUrl: new URL("/api/paypal/return", origin).href,
        cancelUrl: new URL("/api/paypal/cancel", origin).href,
      });
      db.prepare(
        "UPDATE fairshare_payment_ops SET provider_order_id=?,approval_url=?,status='AWAITING_BUYER' WHERE id=?",
      ).run(order.id, order.approvalUrl, op.id);
      return payment(op.id);
    } catch (e) {
      db.prepare(
        "UPDATE fairshare_payment_ops SET status='OUTCOME_UNKNOWN' WHERE id=?",
      ).run(op.id);
      paymentError(e);
    }
  });
  app.post(`${base}/payments/:paymentId/capture`, async (req) => {
    const op = ownPayment(req);
    if (op.status === "ALLOCATED") return { confirmed: true, payment: op };
    if (!op.provider_order_id)
      fail("PAYMENT_OUTCOME_UNKNOWN", "Order creation outcome unknown");
    provider();
    const send = tx(() => {
      const fresh = payment(op.id);
      if (fresh.status !== "AWAITING_BUYER") return false;
      const current = aggregates.read(op.workspace_id, op.collaboration_id);
      if (current.value.reviewHold)
        fail("PAYMENT_HOLD", "Capture blocked while agreement is held");
      if (current.value.activeVersionId !== fresh.version_id)
        fail(
          "PAYMENT_RULES_CHANGED",
          "Capture blocked because approved rules changed",
        );
      const adverse = (
        db
          .prepare(
            "SELECT action FROM fairshare_webhook_inbox WHERE status='PENDING'",
          )
          .all() as any[]
      )
        .map((r) => JSON.parse(r.action))
        .some(
          (a) =>
            a.kind === WebhookActionKind.HoldCapture &&
            ((a.orderId && a.orderId === fresh.provider_order_id) ||
              (fresh.provider_capture_id &&
                (a.providerId === fresh.provider_capture_id ||
                  a.providerIds?.includes(fresh.provider_capture_id)))),
        );
      if (adverse)
        fail("PAYMENT_HOLD", "Capture blocked by an adverse provider event");
      db.prepare(
        "UPDATE fairshare_payment_ops SET status='CAPTURING' WHERE id=?",
      ).run(op.id);
      return true;
    });
    if (send)
      try {
        await provider().captureOrder(op.provider_order_id, `cap-${op.id}`);
      } catch (e) {
        db.prepare(
          "UPDATE fairshare_payment_ops SET status='OUTCOME_UNKNOWN' WHERE id=?",
        ).run(op.id);
        paymentError(e);
      }
    return applyCapture(op);
  });
  app.post(`${base}/payments/:paymentId/reconcile`, async (req) =>
    applyCapture(ownPayment(req)),
  );
  app.get("/api/paypal/return", async () => ({
    status: "PAYMENT_PROCESSING",
    message:
      "PayPal approval received. Return to Fairshare to confirm payment status.",
  }));
  app.get("/api/paypal/cancel", async () => ({
    status: "CHECKOUT_RETURNED",
    message:
      "No payment status is assumed. Return to Fairshare to check your payment.",
  }));
  // v1 compatibility: preserve its collaboration-member authorization and
  // workspace-scoped merchant-ID destination without touching v2 email accounts.
  app.put(`${base}/recipient`, async (req) => {
    const { p, user } = access(req);
    const paypalId = str((req.body as any)?.paypalId);
    if (!/^[A-Z0-9]{13}$/.test(paypalId))
      fail("INVALID_RECIPIENT", "Sandbox PayPal merchant ID required");
    tx(() => {
      if (hasAccountPayoutDestination(db, user.id))
        fail(
          "PAYOUT_DESTINATION_CONFLICT",
          "Manage your account-level payout destination before using this legacy route",
        );
      advancePayoutAccountGeneration(db, user.id);
      db.prepare(
        "INSERT INTO fairshare_recipients VALUES(?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET paypal_id=excluded.paypal_id",
      ).run(p.workspaceId, user.id, paypalId);
      app.store.audit(user.id, p.workspaceId, "PAYOUT_ACCOUNT_SAVED");
    });
    return { configured: true };
  });
  app.get(`${base}/payouts`, async (req) => {
    const { p, user, row } = access(req);
    const organizer = row.value.members.some(
      (member) =>
        member.userId === user.id && member.role === MemberRole.ORGANIZER,
    );
    const query =
      "SELECT id,capture_id,user_id,amount,batch_id,status,item_id FROM fairshare_payout_ops WHERE workspace_id=? AND collaboration_id=?";
    return {
      payouts: organizer
        ? db.prepare(query).all(p.workspaceId, p.collaborationId)
        : db
            .prepare(`${query} AND user_id=?`)
            .all(p.workspaceId, p.collaborationId, user.id),
    };
  });
  async function reconcilePayout(op: any, assertLease: () => void = () => {}) {
    if (!op.batch_id)
      fail(
        "PAYOUT_OUTCOME_UNKNOWN",
        "Do not resubmit; reconcile provider batch first",
      );
    let r;
    try {
      r = await provider().getPayout(op.batch_id, {
        requestId: op.id,
        recipientType: op.recipient_type,
        recipientId: op.recipient_id,
        amountCents: op.amount,
        currency: "USD",
      });
    } catch (e) {
      paymentError(e);
    }
    assertLease();
    const fresh = tx(() => {
      const fresh = db
        .prepare("SELECT status,batch_id FROM fairshare_payout_ops WHERE id=?")
        .get(op.id) as any;
      if (
        !fresh ||
        fresh.batch_id !== op.batch_id ||
        fresh.status !== op.status
      )
        fail("RECONCILIATION_CONFLICT", "Payout changed during provider read");
      const at = payoutTimestamp();
      db.prepare(
        "UPDATE fairshare_payout_ops SET updated_at=CASE WHEN status=? THEN updated_at ELSE ? END,status=?,item_id=? WHERE id=?",
      ).run(r!.status, at, r!.status, r!.itemId, op.id);
      notePayoutStatus(db, aggregates, op, fresh.status, r!.status, at);
      return fresh;
    });
    if (r!.status !== fresh.status)
      app.store.audit("provider", op.workspace_id, "PAYOUT_STATUS_CHANGED", {
        agreementId: op.collaboration_id,
        payoutId: op.id,
        status: r!.status,
      });
    return { id: op.id, status: r!.status, itemId: r!.itemId };
  }
  // Dispatch exact immutable allocations, not an approval/override of anyone's share.
  app.post(`${base}/payouts/dispatch`, async (req) => {
    const { p } = access(req, true);
    const captureId = str((req.body as any)?.captureId);
    provider();
    const ops = tx(() => {
      const row = aggregates.read(p.workspaceId, p.collaborationId);
      if (row.value.reviewHold) fail("PAYMENT_HOLD", "Outgoing funds held");
      const revenue = row.value.revenue.find(
        (r) => r.providerCaptureId === captureId,
      );
      if (!revenue) fail("NOT_FOUND", "Revenue not found");
      const allocations = revenue!.allocations.filter((a) => a.totalCents > 0);
      // Agreement-wide holds (review, refund, adverse event, approvals) stop
      // everyone. A missing payout email only parks that one person.
      const hold = payoutHoldReason(
        db,
        row.value,
        revenue!,
        {
          provider_capture_id: captureId,
          workspace_id: p.workspaceId,
          collaboration_id: p.collaborationId,
        },
        allocations,
      );
      if (hold) fail("PAYMENT_HOLD", payoutHoldMessages[hold]);
      const read = (id: string) =>
        db
          .prepare("SELECT * FROM fairshare_payout_ops WHERE id=?")
          .get(id) as any;
      return allocations.map((a) => {
        const prior = db
          .prepare(
            "SELECT * FROM fairshare_payout_ops WHERE capture_id=? AND user_id=?",
          )
          .get(captureId, a.userId) as any;
        // The unique (capture_id,user_id) row is the only reservation; anything
        // past the parked states has reached, or may have reached, PayPal.
        if (prior && !PARKED_PAYOUT_STATUSES.includes(prior.status))
          return prior;
        if (prior && prior.amount !== a.totalCents)
          fail("PAYOUT_MISMATCH", "Reserved payout differs from allocation");
        const recipient = readPayoutDestination(db, a.userId, p.workspaceId);
        const status = recipient ? "RESERVED" : "WAITING_RECIPIENT";
        if (prior) {
          db.prepare(
            `UPDATE fairshare_payout_ops SET status=?,recipient_type=?,recipient_id=? WHERE id=? AND status IN (${PARKED_PAYOUT_STATUSES.map(() => "?").join(",")})`,
          ).run(
            status,
            recipient?.type ?? prior.recipient_type,
            recipient?.value ?? prior.recipient_id,
            prior.id,
            ...PARKED_PAYOUT_STATUSES,
          );
          return read(prior.id);
        }
        const id = createHash("sha256")
          .update(`${captureId}:${a.userId}`)
          .digest("hex")
          .slice(0, 30);
        db.prepare(
          "INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_type,recipient_id,amount,status) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          p.workspaceId,
          p.collaborationId,
          captureId,
          a.userId,
          recipient?.type ?? RecipientType.PAYPAL_ID,
          recipient?.value ?? "",
          a.totalCents,
          status,
        );
        return read(id);
      });
    });
    const results: {
      id: string;
      userId: string;
      status: string;
      reason?: PayoutWaitReason;
    }[] = [];
    const push = (op: any, status: string) =>
      results.push({
        id: op.id,
        userId: op.user_id,
        status,
        ...(payoutWaitReason(status)
          ? { reason: payoutWaitReason(status)! }
          : {}),
      });
    for (const op of ops) {
      if (op.status !== "RESERVED") {
        push(op, op.status);
        continue;
      } // No retry of an uncertain write.
      const permitted = tx(() => {
        const current = db
          .prepare("SELECT status FROM fairshare_payout_ops WHERE id=?")
          .get(op.id) as { status: string };
        if (current.status !== "RESERVED") return false;
        const row = aggregates.read(p.workspaceId, p.collaborationId);
        const revenue = row.value.revenue.find(
          (r) => r.providerCaptureId === captureId,
        );
        const hold =
          revenue &&
          payoutHoldReason(
            db,
            row.value,
            revenue,
            {
              provider_capture_id: captureId,
              workspace_id: p.workspaceId,
              collaboration_id: p.collaborationId,
            },
            revenue.allocations.filter((a) => a.totalCents > 0),
          );
        if (!revenue || hold) {
          db.prepare(
            "UPDATE fairshare_payout_ops SET status=? WHERE id=? AND status='RESERVED'",
          ).run(
            hold === PayoutHoldReason.ADVERSE_EVENT ? "AUTO_HELD" : "HELD",
            op.id,
          );
          return false;
        }
        // Claim only operations that have never reached the provider. A second
        // dispatcher must not replay an in-flight or uncertain submission.
        const claim = db
          .prepare(
            "UPDATE fairshare_payout_ops SET status='SUBMITTING' WHERE id=? AND status='RESERVED'",
          )
          .run(op.id);
        return claim.changes === 1;
      });
      if (!permitted) {
        const current = db
          .prepare("SELECT status FROM fairshare_payout_ops WHERE id=?")
          .get(op.id) as { status: string };
        push(op, current.status);
        continue;
      }
      try {
        const result = await provider().createPayout({
          requestId: op.id,
          recipientType: op.recipient_type,
          recipientId: op.recipient_id,
          amountCents: op.amount,
          currency: "USD",
        });
        db.prepare(
          "UPDATE fairshare_payout_ops SET batch_id=?,status='PENDING' WHERE id=?",
        ).run(result.batchId, op.id);
        app.store.audit("provider", op.workspace_id, "PAYOUT_SUBMITTED", {
          agreementId: op.collaboration_id,
          payoutId: op.id,
        });
        push(op, "PENDING");
      } catch (e) {
        if (e instanceof PayPalError && e.code === "PAYOUT_NOT_CONFIGURED") {
          // The adapter rejects this before any provider call. Keep the same
          // immutable reservation available after configuration is corrected.
          db.prepare(
            "UPDATE fairshare_payout_ops SET status='RESERVED' WHERE id=? AND status='SUBMITTING' AND batch_id IS NULL",
          ).run(op.id);
          throw e;
        }
        db.prepare(
          "UPDATE fairshare_payout_ops SET status='OUTCOME_UNKNOWN' WHERE id=?",
        ).run(op.id);
        app.store.audit("provider", op.workspace_id, "PAYOUT_OUTCOME_UNKNOWN", {
          agreementId: op.collaboration_id,
          payoutId: op.id,
        });
        push(op, "OUTCOME_UNKNOWN");
      }
    }
    return { payouts: results };
  });
  app.post(`${base}/payouts/:payoutId/reconcile`, async (req) => {
    const { p } = access(req, true);
    const op = db
      .prepare(
        "SELECT * FROM fairshare_payout_ops WHERE id=? AND workspace_id=? AND collaboration_id=?",
      )
      .get(
        str((req.params as any).payoutId),
        p.workspaceId,
        p.collaborationId,
      ) as any;
    if (!op) fail("NOT_FOUND", "Payout not found");
    return reconcilePayout(op);
  });
  async function reconcileRefund(op: any, assertLease: () => void = () => {}) {
    const p = provider();
    if (!p.getRefund)
      fail("REFUND_NOT_CONFIGURED", "Sandbox refund provider required");
    const result = await p.getRefund!(op.provider_refund_id);
    assertLease();
    if (
      result.id !== op.provider_refund_id ||
      result.amountCents !== op.amount ||
      result.currency !== "USD" ||
      result.captureId !== op.capture_id ||
      result.reference !== op.request_key
    )
      fail("REFUND_MISMATCH", "Refund evidence mismatch");
    tx(() => {
      const fresh = db
        .prepare("SELECT * FROM fairshare_refund_ops WHERE id=?")
        .get(op.id) as any;
      if (fresh.provider_refund_id !== result.id)
        fail("RECOVERY_CONFLICT", "Refund evidence changed");
      if (
        ["COMPLETED", "FAILED", "CANCELLED"].includes(fresh.status) &&
        fresh.status !== result.status
      )
        fail("REFUND_STATUS_CONFLICT", "Terminal refund status cannot regress");
      db.prepare("UPDATE fairshare_refund_ops SET status=? WHERE id=?").run(
        result.status,
        op.id,
      );
      settleRefundOp(db, aggregates, op.id, result, now());
    });
  }
  /** A refund PayPal reports (made here or in PayPal): read it back from PayPal, link it to a
   * Fairshare refund if it is one, and take it back out of that payment's split once. */
  function settleProviderRefund(
    captureId: string,
    refund: {
      id: string;
      status: string;
      amountCents: number;
      reference?: string;
      accounting?: { feeReturnedCents: number };
    },
  ) {
    const op = db
      .prepare(
        "SELECT * FROM fairshare_refund_ops WHERE provider_refund_id=? OR (provider_refund_id IS NULL AND request_key=?)",
      )
      .get(refund.id, refund.reference ?? "") as any;
    if (!op)
      return applyRefundToCapture(db, aggregates, {
        captureId,
        refundId: refund.id,
        kind: RefundKind.REFUND,
        grossCents: refund.amountCents,
        feeReturnedCents: refund.accounting?.feeReturnedCents ?? 0,
        at: now(),
      }).held;
    if (op.capture_id !== captureId || op.amount !== refund.amountCents)
      fail("REFUND_MISMATCH", "Refund evidence mismatch");
    if (
      ["COMPLETED", "FAILED", "CANCELLED"].includes(op.status) &&
      op.status !== refund.status
    )
      fail("REFUND_STATUS_CONFLICT", "Terminal refund status cannot regress");
    db.prepare(
      "UPDATE fairshare_refund_ops SET provider_refund_id=?,status=? WHERE id=?",
    ).run(refund.id, refund.status, op.id);
    settleRefundOp(db, aggregates, op.id, refund, now());
    return !!aggregates.read(op.workspace_id, op.collaboration_id).value
      .reviewHold;
  }
  async function processEvent(id: string, assertLease: () => void = () => {}) {
    assertLease();
    const stored = db
      .prepare("SELECT * FROM fairshare_webhook_inbox WHERE id=?")
      .get(id) as any;
    if (stored.status === "DONE") return;
    const action = JSON.parse(stored.action);
    const reconcileInvoiceEvent = async (providerId: string) => {
      const result = await invoices.reconcileProvider(
        providerId,
        assertLease,
        action.eventType,
      );
      if (result.settlementPending)
        fail(
          "INVOICE_SETTLEMENT_PENDING",
          "Invoice settlement still needs provider verification",
        );
    };
    try {
      if (
        action.kind === WebhookActionKind.ReconcileCapture ||
        action.kind === WebhookActionKind.ReconcileOrder
      ) {
        const op = db
          .prepare(
            "SELECT * FROM fairshare_payment_ops WHERE provider_order_id=?",
          )
          .get(action.orderId ?? null) as any;
        if (!op && action.invoiceId) {
          // An INV2 field is a lookup hint only. The invoice path verifies fresh
          // invoice, merchant, settlement identity and accounting before credit.
          await reconcileInvoiceEvent(action.invoiceId);
        } else {
          if (!op) fail("UNMATCHED_EVENT", "Order not found");
          const result = await applyCapture(op, assertLease);
          if (
            !result.confirmed &&
            action.eventType !== "CHECKOUT.ORDER.APPROVED"
          )
            fail("CAPTURE_NOT_CONFIRMED", "Provider capture is not completed");
        }
      } else if (action.kind === WebhookActionKind.ReconcileInvoice) {
        await reconcileInvoiceEvent(action.providerId);
      } else if (action.kind === WebhookActionKind.ReconcileRefund) {
        const op = db
          .prepare(
            "SELECT * FROM fairshare_refund_ops WHERE provider_refund_id=?",
          )
          .get(action.providerId) as any;
        if (!op) fail("UNMATCHED_EVENT", "Refund not found");
        await reconcileRefund(op, assertLease);
      } else if (action.kind === WebhookActionKind.HoldCapture) {
        const captureIds: string[] = action.providerIds?.length
          ? action.providerIds
          : action.providerId
            ? [action.providerId]
            : [];
        if (!captureIds.length && action.orderId) {
          const op = db
            .prepare(
              "SELECT provider_capture_id FROM fairshare_payment_ops WHERE provider_order_id=?",
            )
            .get(action.orderId) as any;
          if (op?.provider_capture_id) captureIds.push(op.provider_capture_id);
        }
        if (!captureIds.length)
          fail("UNMATCHED_EVENT", "Capture provenance needs verification");
        // A capture refund with verified parent provenance is read back from PayPal and taken
        // out of the split. A refund PayPal still reports as pending keeps this event open,
        // which keeps that agreement's payouts waiting.
        let verifiedRefund: Awaited<
          ReturnType<NonNullable<PaymentProvider["getRefund"]>>
        > | null = null;
        const refunds = provider().getRefund;
        if (
          action.eventType === "PAYMENT.CAPTURE.REFUNDED" &&
          action.refundId &&
          action.captureProvenance &&
          captureIds.length === 1 &&
          refunds
        ) {
          const refund = await refunds(action.refundId);
          assertLease();
          if (
            refund.id !== action.refundId ||
            refund.currency !== "USD" ||
            (refund.captureId !== undefined &&
              refund.captureId !== captureIds[0])
          )
            fail("REFUND_MISMATCH", "Refund evidence mismatch");
          if (refund.status === "PENDING")
            fail("REFUND_PENDING", "PayPal has not finished this refund");
          if (refund.status === "COMPLETED") verifiedRefund = refund;
        }
        let unmatched = false;
        tx(() => {
          for (const captureId of captureIds) {
            const match = db
              .prepare(
                "SELECT * FROM fairshare_captures WHERE provider_capture_id=?",
              )
              .get(captureId) as any;
            if (!match) {
              unmatched = true;
              continue;
            }
            if (action.eventType.startsWith("CUSTOMER.DISPUTE."))
              recordDispute(db, action, captureIds, match, now());
            if (verifiedRefund) {
              if (settleProviderRefund(captureId, verifiedRefund))
                invoices.markSettlementHeld(captureId);
              continue;
            }
            // PayPal took the payment back: it comes out of the split like a refund with the fee
            // kept, and payouts pause for review.
            const reversal =
              action.eventType === "PAYMENT.CAPTURE.REVERSED"
                ? applyReversal(
                    db,
                    aggregates,
                    {
                      reversalId: id,
                      captureId,
                      statedCents: action.amountCents,
                      at: now(),
                    },
                    match,
                  )
                : 0;
            // Nothing to take out now (already refunded, or set aside for refunds in flight):
            // still pause the agreement.
            if (!reversal || (!reversal.replayed && !reversal.appliedCents)) {
              const row = aggregates.read(
                match.workspace_id,
                match.collaboration_id,
              );
              aggregates.updateInsideTransaction(
                match.workspace_id,
                match.collaboration_id,
                row.revision,
                (c) => holdReversedRevenue(c, captureId, action.reason, now()),
              );
            }
            invoices.markSettlementHeld(captureId);
          }
        });
        // Hold every known transaction even if another dispute transaction needs matching.
        if (unmatched) fail("UNMATCHED_EVENT", "Capture not found");
      } else if (action.kind === WebhookActionKind.ReconcilePayout) {
        const ops = db
          .prepare("SELECT * FROM fairshare_payout_ops WHERE batch_id=?")
          .all(action.providerId) as any[];
        if (!ops.length) fail("UNMATCHED_EVENT", "Payout not found");
        for (const op of ops) await reconcilePayout(op, assertLease);
      } else if (action.kind === WebhookActionKind.RecordUnmatched)
        fail(
          action.reason === "UNSUPPORTED_WEBHOOK_EVENT"
            ? "UNSUPPORTED_WEBHOOK_EVENT"
            : "UNMATCHED_EVENT",
          "Provider event needs matching",
        );
      assertLease();
      db.prepare(
        "UPDATE fairshare_webhook_inbox SET status='DONE',error=NULL WHERE id=?",
      ).run(id);
    } catch (e) {
      assertLease();
      db.prepare(
        "UPDATE fairshare_webhook_inbox SET status='PENDING',error=? WHERE id=? AND status<>'DONE'",
      ).run(
        e instanceof DomainError || e instanceof PayPalError
          ? e.code
          : "RECONCILIATION_FAILED",
        id,
      );
    }
  }
  app.post("/api/paypal/webhook", async (req, reply) => {
    let planned;
    try {
      planned = await verifyAndPlanWebhook(provider(), req.headers, req.body);
    } catch (e) {
      // Still fail closed (503); only make the cause visible to operators.
      if (
        e instanceof PayPalError &&
        e.code === "PAYPAL_WEBHOOK_NOT_CONFIGURED"
      )
        reportWebhookNotConfigured();
      paymentError(e);
    }
    tx(() => {
      const old = db
        .prepare(
          "SELECT fingerprint,action,status FROM fairshare_webhook_inbox WHERE id=?",
        )
        .get(planned!.eventId) as any;
      if (old) {
        if (old.fingerprint !== planned!.fingerprint)
          fail(
            "WEBHOOK_EVENT_ID_CONFLICT",
            "Event ID reused with changed payload",
          );
        if (
          canRepairUnsupportedPlan(JSON.parse(old.action), planned!.action) ||
          (old.status === "PENDING" &&
            canRepairRefundPlan(JSON.parse(old.action), planned!.action))
        ) {
          db.prepare(
            "UPDATE fairshare_webhook_inbox SET action=?,status='PENDING',error=NULL WHERE id=?",
          ).run(JSON.stringify(planned!.action), planned!.eventId);
        }
        return;
      }
      db.prepare(
        "INSERT INTO fairshare_webhook_inbox VALUES(?,?,?,?,NULL)",
      ).run(
        planned!.eventId,
        planned!.fingerprint,
        JSON.stringify(planned!.action),
        "PENDING",
      );
    });
    await processEvent(planned!.eventId);
    const stored = db
      .prepare("SELECT status,action FROM fairshare_webhook_inbox WHERE id=?")
      .get(planned!.eventId) as any;
    const storedAction = JSON.parse(stored.action);
    const unsupported = storedAction.reason === "UNSUPPORTED_WEBHOOK_EVENT";
    return reply
      .code(stored.status === "DONE" ? 200 : unsupported ? 400 : 503)
      .send({
        accepted: !unsupported,
        status: stored.status,
        action: storedAction.kind,
        ...(unsupported
          ? {
              error: {
                code: "UNSUPPORTED_WEBHOOK_EVENT",
                message: "Webhook event type is not supported",
              },
            }
          : {}),
      });
  });
  registerPaymentRecovery({
    app,
    aggregates,
    provider,
    access,
    ownPayment,
    applyCapture,
    processEvent,
  });
  const invoices = registerInvoiceRoutes(app, aggregates, provider);
  const automatic = options.automaticPayoutsEnabled
    ? automaticPayouts(app, aggregates, provider())
    : undefined;
  app.get(`${base}/payments/setup`, async (req) => {
    access(req);
    return {
      automaticPayouts: Boolean(automatic) && payoutsReady(),
      payoutsReady: payoutsReady(),
      paymentConfirmation: paymentConfirmation(),
    };
  });
  const worker = options.reconciliation?.enabled
    ? createReconciliationWorker({
        db,
        intervalMs: options.reconciliation.intervalMs,
        discover: () => [
          ...invoices.discover(),
          ...(automatic?.discover() ?? []),
          ...(
            db
              .prepare(
                "SELECT id FROM fairshare_payment_ops WHERE provider_order_id IS NOT NULL AND status IN ('AWAITING_BUYER','CAPTURING','OUTCOME_UNKNOWN')",
              )
              .all() as any[]
          ).map((r) => ({ kind: "PAYMENT", id: r.id })),
          ...(
            db
              .prepare(
                "SELECT id FROM fairshare_payout_ops WHERE batch_id IS NOT NULL AND status IN ('PENDING','ONHOLD','UNCLAIMED','OUTCOME_UNKNOWN')",
              )
              .all() as any[]
          ).map((r) => ({ kind: "PAYOUT", id: r.id })),
          ...(
            db
              .prepare(
                "SELECT id FROM fairshare_refund_ops WHERE provider_refund_id IS NOT NULL AND status IN ('PENDING','SUBMITTING','OUTCOME_UNKNOWN')",
              )
              .all() as any[]
          ).map((r) => ({ kind: "REFUND", id: r.id })),
          ...(
            db
              .prepare(
                "SELECT id FROM fairshare_webhook_inbox WHERE status='PENDING'",
              )
              .all() as any[]
          ).map((r) => ({ kind: "WEBHOOK", id: r.id })),
        ],
        reconcile: async (job, assertLease) => {
          if (job.kind === "INVOICE") {
            await invoices.reconcile(job.id, assertLease);
            return;
          }
          if (job.kind === "AUTO_PAYOUT") {
            await automatic!.dispatch(job.id, assertLease);
            return;
          }
          if (job.kind === "PAYMENT") {
            await applyCapture(payment(job.id), assertLease);
            return;
          }
          if (job.kind === "PAYOUT") {
            const op = db
              .prepare("SELECT * FROM fairshare_payout_ops WHERE id=?")
              .get(job.id);
            await reconcilePayout(op, assertLease);
            return;
          }
          if (job.kind === "WEBHOOK") {
            await processEvent(job.id, assertLease);
            const row = db
              .prepare("SELECT status FROM fairshare_webhook_inbox WHERE id=?")
              .get(job.id) as any;
            if (row.status !== "DONE")
              fail(
                "RECONCILIATION_PENDING",
                "Event still requires reconciliation",
              );
            return;
          }
          if (job.kind === "REFUND") {
            const op = db
              .prepare("SELECT * FROM fairshare_refund_ops WHERE id=?")
              .get(job.id) as any;
            await reconcileRefund(op, assertLease);
          }
        },
      })
    : undefined;
  app.decorate("paymentReconciliation", worker ?? null);
  if (worker) {
    if (!options.reconciliation?.externalScheduling)
      app.addHook("onReady", async () => worker.start());
    app.addHook("preClose", async () => worker.stop());
  }
  return { processEvent, worker };
}
