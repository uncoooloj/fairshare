import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
  DomainError,
  MemberRole,
  allocateConfirmedRevenue,
  holdReversedRevenue,
} from "@fairshare/domain";
import { PayPalError, type InvoiceSettlement } from "@fairshare/payments";
import type { AggregateStore } from "./fairshare.js";
import type { FairshareApp } from "./app.js";
import { Role } from "./identity.js";

export interface InvoiceEvidence {
  id: string;
  status: string;
  reference: string;
  currency: string;
  amountCents: number;
  shareUrl: string | null;
  paidAmountCents?: number;
  dueAmountCents?: number;
  payments: {
    transactionId: string;
    type: string;
    amountCents: number;
    currency: string;
    status?: string;
    paidDate?: string;
  }[];
}
export interface InvoiceProvider {
  createInvoice(input: {
    customerEmail: string;
    customerName?: string;
    description: string;
    amountCents: number;
    currency: "USD";
    dueDate: string;
    reference: string;
    requestId: string;
  }): Promise<InvoiceEvidence>;
  publishInvoice(id: string, requestId: string): Promise<InvoiceEvidence>;
  getInvoice(id: string): Promise<InvoiceEvidence>;
  getInvoiceSettlement?(
    invoiceId: string,
    transactionId: string,
  ): Promise<InvoiceSettlement>;
}
const fail = (code: string, message: string): never => {
  throw new DomainError(code, message);
};
export function validateInvoice(input: any) {
  const text = (value: unknown, max: number) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= max
      ? value.trim()
      : fail(
          "INVALID_INPUT",
          "Invoice fields must be nonempty and within their limits",
        );
  const requestKey = text(input?.requestKey, 128);
  const customerEmail = text(input?.customerEmail, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))
    fail("INVALID_INPUT", "Valid customer email required");
  const customerName = text(input?.customerName, 128);
  const description = text(input?.description, 500);
  if (
    !Number.isSafeInteger(input?.amountCents) ||
    input.amountCents < 1 ||
    input.amountCents > 1_000_000 ||
    input.currency !== "USD"
  )
    fail("INVALID_MONEY", "Invoice amount must be 1 to 1000000 USD cents");
  const dueDate = text(input?.dueDate, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
    !Number.isFinite(Date.parse(dueDate)) ||
    new Date(dueDate).toISOString().slice(0, 10) !== dueDate
  )
    fail("INVALID_INPUT", "Valid invoice due date required");
  return {
    requestKey,
    customerEmail,
    customerName,
    description,
    amountCents: input.amountCents as number,
    currency: "USD" as const,
    dueDate,
  };
}
export function registerInvoiceRoutes(
  app: FairshareApp,
  aggregates: AggregateStore,
  getProvider: () => Partial<InvoiceProvider>,
) {
  const db = app.store.db;
  db.exec(
    `CREATE TABLE IF NOT EXISTS fairshare_invoices(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, collaboration_id TEXT NOT NULL, request_key TEXT NOT NULL, version_id INTEGER NOT NULL, payload TEXT NOT NULL, provider_id TEXT UNIQUE, status TEXT NOT NULL, share_url TEXT, capture_id TEXT UNIQUE, created_at TEXT NOT NULL, UNIQUE(workspace_id, request_key));`,
  );
  for (const [name, definition] of [
    ["provider_status", "TEXT"],
    ["paid_amount", "INTEGER"],
    ["due_amount", "INTEGER"],
    ["settlement_status", "TEXT NOT NULL DEFAULT 'UNVERIFIED'"],
    ["settlement_error", "TEXT"],
    ["checked_at", "TEXT"],
    ["paid_date", "TEXT"],
    ["evidence_revision", "INTEGER NOT NULL DEFAULT 0"],
  ]) {
    if (
      !(
        db.prepare("PRAGMA table_info(fairshare_invoices)").all() as any[]
      ).some((column) => column.name === name)
    )
      db.exec(
        `ALTER TABLE fairshare_invoices ADD COLUMN ${name} ${definition}`,
      );
  }
  const base =
    "/api/workspaces/:workspaceId/collaborations/:collaborationId/invoices";
  function provider(): InvoiceProvider {
    const p = getProvider();
    if (!p.createInvoice || !p.publishInvoice || !p.getInvoice)
      fail("PAYPAL_NOT_CONFIGURED", "Invoice provider is not configured");
    return p as InvoiceProvider;
  }
  const read = (id: string): any =>
    db.prepare("SELECT * FROM fairshare_invoices WHERE id=?").get(id) ??
    fail("NOT_FOUND", "Invoice not found");
  const dto = (r: any) => ({
    ...JSON.parse(r.payload),
    id: r.id,
    status: r.status,
    shareUrl: r.share_url,
    createdAt: r.created_at,
    providerId: r.provider_id,
    providerStatus: r.provider_status,
    paidAmountCents: r.paid_amount,
    dueAmountCents: r.due_amount,
    settlementStatus:
      r.capture_id &&
      aggregates.read(r.workspace_id, r.collaboration_id).value.reviewHold
        ? "HELD"
        : r.settlement_status,
    settlementError: r.settlement_error,
    checkedAt: r.checked_at,
    paidDate: r.paid_date,
  });
  function access(req: FastifyRequest, write = false) {
    const p = req.params as any;
    const { user } = app.requireWorkspace(
      req,
      p.workspaceId,
      write ? [Role.OWNER, Role.MEMBER] : undefined,
    );
    const row = aggregates.read(p.workspaceId, p.collaborationId);
    const member = row.value.members.find((m) => m.userId === user.id);
    if (!member || (write && member.role !== MemberRole.ORGANIZER))
      fail("FORBIDDEN", "Agreement organizer required");
    return p;
  }
  function check(op: any, evidence: InvoiceEvidence) {
    const input = JSON.parse(op.payload);
    if (
      evidence.id !== op.provider_id ||
      evidence.reference !== op.id ||
      evidence.currency !== input.currency ||
      evidence.amountCents !== input.amountCents
    )
      fail(
        "INVOICE_MISMATCH",
        "Invoice evidence does not match reserved invoice",
      );
    if (evidence.shareUrl) {
      const url = new URL(evidence.shareUrl);
      if (
        url.protocol !== "https:" ||
        !["www.sandbox.paypal.com", "sandbox.paypal.com"].includes(
          url.hostname,
        ) ||
        url.username ||
        url.password ||
        url.port
      )
        fail("INVOICE_MISMATCH", "Invalid sandbox invoice link");
    }
  }
  function localStatus(evidence: InvoiceEvidence) {
    if (evidence.status === "DRAFT") return "DRAFT";
    if (
      ["SENT", "SCHEDULED", "UNPAID"].includes(evidence.status) &&
      evidence.shareUrl
    )
      return "SHARED";
    if (evidence.status === "PAID") return "PAYMENT_RECORDED";
    return evidence.status;
  }
  const adverseStatuses = new Set([
    "CANCELLED",
    "REFUNDED",
    "PARTIALLY_REFUNDED",
    "MARKED_AS_REFUNDED",
  ]);
  function holdInvoice(op: any, reason: string) {
    // A cancellation/refund before allocation is a durable tombstone too.
    db.prepare(
      "UPDATE fairshare_invoices SET settlement_status='HELD' WHERE id=?",
    ).run(op.id);
    if (!op.capture_id) return;
    const row = aggregates.read(op.workspace_id, op.collaboration_id);
    aggregates.updateInsideTransaction(
      op.workspace_id,
      op.collaboration_id,
      row.revision,
      (value) =>
        holdReversedRevenue(
          value,
          op.capture_id,
          reason,
          new Date().toISOString(),
        ),
    );
    db.prepare(
      "UPDATE fairshare_invoices SET settlement_status='HELD' WHERE workspace_id=? AND collaboration_id=? AND capture_id IS NOT NULL",
    ).run(op.workspace_id, op.collaboration_id);
  }
  function recordEvidence(
    op: any,
    evidence: InvoiceEvidence,
    status: string,
    error: string | null,
  ) {
    const fresh = read(op.id);
    if (
      fresh.evidence_revision !== op.evidence_revision ||
      fresh.provider_id !== evidence.id
    )
      fail(
        "RECONCILIATION_CONFLICT",
        "Invoice changed during provider read; check again",
      );
    const preservedVerifiedPayment =
      status === "PAYMENT_RECORDED" &&
      fresh.status === "PAID" &&
      fresh.settlement_status === "VERIFIED" &&
      fresh.capture_id;
    db.prepare(
      `UPDATE fairshare_invoices SET status=?,provider_status=?,share_url=?,paid_amount=?,due_amount=?,settlement_error=?,checked_at=?,paid_date=?,evidence_revision=evidence_revision+1 WHERE id=?`,
    ).run(
      preservedVerifiedPayment ? "PAID" : status,
      evidence.status,
      evidence.shareUrl,
      evidence.paidAmountCents ?? null,
      evidence.dueAmountCents ?? null,
      error,
      new Date().toISOString(),
      evidence.payments.length === 1
        ? (evidence.payments[0].paidDate ?? null)
        : null,
      op.id,
    );
  }
  async function reconcile(
    id: string,
    assertLease: () => void = () => {},
    eventType?: string,
  ) {
    const op = read(id);
    if (!op.provider_id) return { invoice: dto(op), settlementPending: false };
    const evidence = await provider().getInvoice(op.provider_id);
    check(op, evidence);
    assertLease();
    if (evidence.status !== "PAID") {
      app.store.tx(() => {
        recordEvidence(op, evidence, localStatus(evidence), null);
        if (adverseStatuses.has(evidence.status))
          holdInvoice(read(id), `INVOICE_${evidence.status}`);
      });
      const waitingForPaidEvent =
        [
          "INVOICING.INVOICE.PAID",
          "PAYMENT.SALE.COMPLETED",
          "PAYMENT.CAPTURE.COMPLETED",
        ].includes(eventType ?? "") &&
        !adverseStatuses.has(evidence.status) &&
        evidence.status !== "MARKED_AS_PAID";
      return { invoice: dto(read(id)), settlementPending: waitingForPaidEvent };
    }
    // A payment ID is only a lookup candidate. Only a fresh capture with this
    // exact INV2 identity, merchant, currency, gross and actual fees may allocate.
    const payments = evidence.payments;
    const candidate = payments.length === 1 ? payments[0] : undefined;
    let settlement: InvoiceSettlement | undefined;
    let error: string | null = null;
    if (
      !candidate ||
      (evidence.paidAmountCents !== undefined &&
        evidence.paidAmountCents !== evidence.amountCents) ||
      (evidence.dueAmountCents !== undefined &&
        evidence.dueAmountCents !== 0) ||
      candidate.type !== "PAYPAL" ||
      candidate.amountCents !== evidence.amountCents ||
      candidate.currency !== evidence.currency ||
      (candidate.status !== undefined && candidate.status !== "SUCCESS")
    ) {
      error = "INVOICE_SETTLEMENT_UNSUPPORTED";
    } else if (!provider().getInvoiceSettlement) {
      error = "INVOICE_SETTLEMENT_NOT_CONFIGURED";
    } else {
      try {
        settlement = await provider().getInvoiceSettlement!(
          evidence.id,
          candidate.transactionId,
        );
        if (
          settlement.id !== candidate.transactionId ||
          settlement.invoiceId !== evidence.id ||
          settlement.currency !== evidence.currency ||
          settlement.amountCents !== evidence.amountCents
        )
          fail(
            "INVOICE_SETTLEMENT_MISMATCH",
            "Invoice settlement does not match invoice",
          );
        if (settlement.status !== "COMPLETED")
          error = "INVOICE_SETTLEMENT_PENDING";
        else if (
          !settlement.accounting ||
          !Number.isSafeInteger(settlement.accounting.feeCents) ||
          settlement.accounting.feeCents < 0 ||
          !Number.isSafeInteger(settlement.accounting.netCents) ||
          settlement.accounting.netCents < 0 ||
          settlement.accounting.feeCents + settlement.accounting.netCents !==
            settlement.amountCents
        )
          error = "CAPTURE_ACCOUNTING_REQUIRED";
      } catch (cause) {
        error =
          cause instanceof PayPalError || cause instanceof DomainError
            ? cause.code
            : "INVOICE_SETTLEMENT_UNAVAILABLE";
      }
    }
    assertLease();
    if (error || !settlement) {
      app.store.tx(() => {
        recordEvidence(op, evidence, "PAYMENT_RECORDED", error);
        if (
          settlement &&
          [
            "REFUNDED",
            "PARTIALLY_REFUNDED",
            "DECLINED",
            "FAILED",
            "DENIED",
          ].includes(settlement.status)
        )
          holdInvoice(read(id), `SETTLEMENT_${settlement.status}`);
      });
      return { invoice: dto(read(id)), settlementPending: true };
    }
    try {
      app.store.tx(() => {
        const fresh = read(id);
        if (fresh.evidence_revision !== op.evidence_revision)
          fail(
            "RECONCILIATION_CONFLICT",
            "Invoice changed during provider read; check again",
          );
        const capture = settlement!;
        if (!fresh.capture_id && fresh.settlement_status === "HELD")
          fail(
            "PAYMENT_HOLD",
            "Invoice has an unresolved adverse provider event",
          );
        if (fresh.capture_id && fresh.capture_id !== capture.id)
          fail(
            "CAPTURE_ALREADY_USED",
            "Invoice already has a different settlement",
          );
        const adverse = (
          db
            .prepare(
              "SELECT action FROM fairshare_webhook_inbox WHERE status='PENDING'",
            )
            .all() as any[]
        )
          .map((entry) => JSON.parse(entry.action))
          .some(
            (action) =>
              (action.kind === "HOLD_CAPTURE" &&
                (action.providerId === capture.id ||
                  action.providerIds?.includes(capture.id))) ||
              (action.kind === "RECONCILE_INVOICE" &&
                action.providerId === op.provider_id &&
                [
                  "INVOICING.INVOICE.REFUNDED",
                  "INVOICING.INVOICE.CANCELLED",
                ].includes(action.eventType)),
          );
        if (adverse)
          fail(
            "PAYMENT_HOLD",
            "An adverse provider event is awaiting reconciliation",
          );
        const row = aggregates.read(op.workspace_id, op.collaboration_id);
        if (!fresh.capture_id && row.value.activeVersionId !== op.version_id)
          fail(
            "PAYMENT_RULES_CHANGED",
            "Invoice rules changed before settlement verification",
          );
        const existing = db
          .prepare(
            "SELECT * FROM fairshare_captures WHERE provider_capture_id=?",
          )
          .get(capture.id) as any;
        if (
          existing &&
          (!fresh.capture_id ||
            existing.workspace_id !== op.workspace_id ||
            existing.collaboration_id !== op.collaboration_id)
        )
          fail(
            "CAPTURE_ALREADY_USED",
            "Settlement is already assigned to another payment or invoice",
          );
        const value = allocateConfirmedRevenue(
          row.value,
          {
            providerCaptureId: capture.id,
            currency: "USD",
            grossCents: capture.amountCents,
            feeCents: capture.accounting!.feeCents,
          },
          new Date().toISOString(),
        );
        aggregates.updateInsideTransaction(
          op.workspace_id,
          op.collaboration_id,
          row.revision,
          () => value,
        );
        db.prepare(
          "INSERT OR IGNORE INTO fairshare_captures VALUES(?,?,?)",
        ).run(capture.id, op.workspace_id, op.collaboration_id);
        const held =
          value.reviewHold ||
          value.revenue.find((entry) => entry.providerCaptureId === capture.id)
            ?.status === "REVIEW_REQUIRED";
        db.prepare(
          "UPDATE fairshare_invoices SET capture_id=?,settlement_status=? WHERE id=?",
        ).run(capture.id, held ? "HELD" : "VERIFIED", op.id);
        recordEvidence(op, evidence, "PAID", null);
      });
    } catch (cause) {
      // Preserve the real provider payment in the UI even when allocation is held.
      if (
        !(cause instanceof DomainError) ||
        cause.code === "RECONCILIATION_CONFLICT"
      )
        throw cause;
      app.store.tx(() =>
        recordEvidence(op, evidence, "PAYMENT_RECORDED", cause.code),
      );
      return { invoice: dto(read(id)), settlementPending: true };
    }
    return { invoice: dto(read(id)), settlementPending: false };
  }
  app.get(base, async (req) => {
    const p = access(req);
    return {
      invoices: (
        db
          .prepare(
            "SELECT * FROM fairshare_invoices WHERE workspace_id=? AND collaboration_id=? ORDER BY created_at DESC",
          )
          .all(p.workspaceId, p.collaborationId) as any[]
      ).map(dto),
    };
  });
  app.post(base, async (req) => {
    const p = access(req, true),
      input = validateInvoice(req.body);
    const reservation = app.store.tx(() => {
      const prior = db
        .prepare(
          "SELECT * FROM fairshare_invoices WHERE workspace_id=? AND request_key=?",
        )
        .get(p.workspaceId, input.requestKey) as any;
      if (prior) {
        if (
          prior.collaboration_id !== p.collaborationId ||
          prior.payload !== JSON.stringify(input)
        )
          fail(
            "IDEMPOTENCY_CONFLICT",
            "Request key reused with changed invoice",
          );
        return { created: false, op: prior };
      }
      if (input.dueDate < new Date().toISOString().slice(0, 10))
        fail("INVALID_INPUT", "Due date cannot be in the past");
      provider();
      const row = aggregates.read(p.workspaceId, p.collaborationId);
      if (!row.value.activeVersionId || row.value.reviewHold)
        fail("PAYMENT_HOLD", "Active approved agreement required");
      const id = randomUUID();
      db.prepare(
        "INSERT INTO fairshare_invoices(id,workspace_id,collaboration_id,request_key,version_id,payload,status,created_at) VALUES(?,?,?,?,?,?,'CREATING',?)",
      ).run(
        id,
        p.workspaceId,
        p.collaborationId,
        input.requestKey,
        row.value.activeVersionId,
        JSON.stringify(input),
        new Date().toISOString(),
      );
      return { created: true, op: read(id) };
    });
    const op = reservation.op;
    if (!reservation.created) return { invoice: dto(op) };
    try {
      const draft = await provider().createInvoice({
        ...input,
        reference: op.id,
        requestId: op.id,
      });
      // Persist provider identity before any second external write.
      db.prepare(
        "UPDATE fairshare_invoices SET provider_id=?,status='DRAFT' WHERE id=?",
      ).run(draft.id, op.id);
      check(read(op.id), draft);
      // Creating a draft is irreversible; publishing it is a separate provider
      // write and must use current agreement authorization and version state.
      access(req, true);
      const current = aggregates.read(p.workspaceId, p.collaborationId);
      if (
        current.value.reviewHold ||
        current.value.activeVersionId !== op.version_id
      )
        fail("PAYMENT_HOLD", "Active approved agreement required");
      db.prepare(
        "UPDATE fairshare_invoices SET status='PUBLISHING' WHERE id=?",
      ).run(op.id);
      const publishing = read(op.id);
      const published = await provider().publishInvoice(
        draft.id,
        `publish-${op.id}`,
      );
      check(read(op.id), published);
      app.store.tx(() =>
        recordEvidence(publishing, published, localStatus(published), null),
      );
      return { invoice: dto(read(op.id)) };
    } catch (error) {
      db.prepare(
        "UPDATE fairshare_invoices SET status='UNKNOWN' WHERE id=? AND status IN ('CREATING','DRAFT','PUBLISHING')",
      ).run(op.id);
      throw error;
    }
  });
  // An unknown create is recovered by a read, never by blindly creating another invoice.
  app.post(`${base}/:invoiceId/recover`, async (req) => {
    const p = access(req, true),
      op = read(p.invoiceId);
    if (
      op.workspace_id !== p.workspaceId ||
      op.collaboration_id !== p.collaborationId
    )
      fail("NOT_FOUND", "Invoice not found");
    const providerId = (req.body as any)?.providerId;
    if (
      typeof providerId !== "string" ||
      !/^INV2-[A-Z0-9-]{1,64}$/.test(providerId)
    )
      fail("INVALID_INPUT", "Valid PayPal invoice ID required");
    const evidence = await provider().getInvoice(providerId);
    check({ ...op, provider_id: providerId }, evidence);
    app.store.tx(() => {
      const fresh = read(op.id);
      if (fresh.provider_id && fresh.provider_id !== providerId)
        fail(
          "RECOVERY_CONFLICT",
          "Invoice already linked to another provider invoice",
        );
      db.prepare("UPDATE fairshare_invoices SET provider_id=? WHERE id=?").run(
        providerId,
        op.id,
      );
    });
    return reconcile(op.id);
  });
  app.post(`${base}/:invoiceId/reconcile`, async (req) => {
    const p = access(req, true),
      op = read(p.invoiceId);
    if (
      op.workspace_id !== p.workspaceId ||
      op.collaboration_id !== p.collaborationId
    )
      fail("NOT_FOUND", "Invoice not found");
    return reconcile(op.id);
  });
  return {
    reconcile,
    markSettlementHeld(captureId: string) {
      const match = db
        .prepare(
          "SELECT workspace_id,collaboration_id FROM fairshare_captures WHERE provider_capture_id=?",
        )
        .get(captureId) as any;
      if (match)
        db.prepare(
          "UPDATE fairshare_invoices SET settlement_status='HELD' WHERE workspace_id=? AND collaboration_id=? AND capture_id IS NOT NULL",
        ).run(match.workspace_id, match.collaboration_id);
    },
    async reconcileProvider(
      providerId: string,
      assertLease: () => void = () => {},
      eventType?: string,
    ) {
      const op = db
        .prepare("SELECT * FROM fairshare_invoices WHERE provider_id=?")
        .get(providerId) as any;
      if (!op) fail("UNMATCHED_EVENT", "Invoice not found");
      if (
        ["INVOICING.INVOICE.REFUNDED", "INVOICING.INVOICE.CANCELLED"].includes(
          eventType ?? "",
        )
      ) {
        assertLease();
        app.store.tx(() => holdInvoice(op, eventType!));
      }
      return reconcile(op.id, assertLease, eventType);
    },
    paymentRecords(workspaceId: string, collaborationId: string) {
      return (
        db
          .prepare(
            "SELECT * FROM fairshare_invoices WHERE workspace_id=? AND collaboration_id=? AND (provider_status IN ('PAID','PARTIALLY_PAID') OR capture_id IS NOT NULL)",
          )
          .all(workspaceId, collaborationId) as any[]
      ).map((row) => ({
        id: row.id,
        invoice_id: row.id,
        amount:
          row.paid_amount ??
          (row.capture_id ? JSON.parse(row.payload).amountCents : null),
        provider_capture_id: row.capture_id,
        source_type: row.capture_id ? "PAYPAL" : "OTHER",
        source_name: row.capture_id
          ? "PayPal invoice"
          : "Invoice payment · unverified",
        status:
          row.capture_id &&
          aggregates.read(row.workspace_id, row.collaboration_id).value
            .reviewHold
            ? "HELD"
            : row.settlement_status === "VERIFIED"
              ? "ALLOCATED"
              : row.settlement_status === "HELD"
                ? "HELD"
                : "PAYMENT_PENDING",
      }));
    },
    discover: () =>
      (
        db
          .prepare(
            "SELECT id FROM fairshare_invoices WHERE provider_id IS NOT NULL AND status NOT IN ('PAID','CREATING','CANCELLED','REFUNDED','MARKED_AS_REFUNDED')",
          )
          .all() as { id: string }[]
      ).map((r) => ({ kind: "INVOICE", id: r.id })),
  };
}
