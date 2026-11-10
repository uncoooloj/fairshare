import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
  allocateConfirmedRevenue,
  DomainError,
  MemberRole,
} from "@fairshare/domain";
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
  payments: {
    transactionId: string;
    type: string;
    amountCents: number;
    currency: string;
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
  getCapture(id: string): Promise<{
    id: string;
    status: string;
    currency: string;
    amountCents: number;
    accounting?: { feeCents: number; netCents: number };
  }>;
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
  const base =
    "/api/workspaces/:workspaceId/collaborations/:collaborationId/invoices";
  function provider(): InvoiceProvider {
    const p = getProvider();
    if (!p.createInvoice || !p.publishInvoice || !p.getInvoice || !p.getCapture)
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
  async function reconcile(id: string, assertLease: () => void = () => {}) {
    const op = read(id);
    if (!op.provider_id || op.status === "PAID") return { invoice: dto(op) };
    const evidence = await provider().getInvoice(op.provider_id);
    check(op, evidence);
    assertLease();
    // A manually marked invoice or an external payment is never money evidence.
    if (evidence.status !== "PAID") {
      const status =
        evidence.status === "DRAFT"
          ? "DRAFT"
          : ["CANCELLED", "REFUNDED", "MARKED_AS_PAID"].includes(
                evidence.status,
              )
            ? "PAYMENT_PENDING"
            : "SHARED";
      db.prepare(
        "UPDATE fairshare_invoices SET status=?,share_url=? WHERE id=? AND status!='PAID'",
      ).run(status, evidence.shareUrl, id);
      return { invoice: dto(read(id)) };
    }
    db.prepare(
      "UPDATE fairshare_invoices SET status='PAYMENT_PENDING',share_url=? WHERE id=? AND status!='PAID'",
    ).run(evidence.shareUrl, id);
    const payments = evidence.payments;
    if (
      payments.length !== 1 ||
      payments[0].type !== "PAYPAL" ||
      payments[0].amountCents !== evidence.amountCents ||
      payments[0].currency !== "USD"
    )
      return { invoice: dto(read(id)) };
    const capture = await provider().getCapture(payments[0].transactionId);
    if (
      capture.id !== payments[0].transactionId ||
      capture.status !== "COMPLETED" ||
      capture.amountCents !== evidence.amountCents ||
      capture.currency !== "USD" ||
      !capture.accounting ||
      !Number.isSafeInteger(capture.accounting.feeCents) ||
      capture.accounting.feeCents < 0 ||
      capture.accounting.netCents + capture.accounting.feeCents !==
        capture.amountCents
    )
      fail(
        "INVOICE_CAPTURE_UNVERIFIED",
        "Invoice capture and fee accounting must be verified",
      );
    assertLease();
    return app.store.tx(() => {
      const fresh = read(id);
      if (fresh.status === "PAID") return { invoice: dto(fresh) };
      const row = aggregates.read(op.workspace_id, op.collaboration_id);
      if (row.value.reviewHold || row.value.activeVersionId !== op.version_id)
        fail("PAYMENT_HOLD", "Invoice rules changed or agreement is held");
      const used = db
        .prepare("SELECT * FROM fairshare_captures WHERE provider_capture_id=?")
        .get(capture.id);
      if (used) fail("CAPTURE_ALREADY_USED", "Capture already allocated");
      const adverse = (
        db
          .prepare(
            "SELECT action FROM fairshare_webhook_inbox WHERE status='PENDING'",
          )
          .all() as any[]
      ).some((r) => JSON.parse(r.action).providerId === capture.id);
      if (adverse)
        fail("PAYMENT_HOLD", "Provider event requires reconciliation");
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
            new Date().toISOString(),
          ),
      );
      db.prepare("INSERT INTO fairshare_captures VALUES(?,?,?)").run(
        capture.id,
        op.workspace_id,
        op.collaboration_id,
      );
      db.prepare(
        "UPDATE fairshare_invoices SET status='PAID',capture_id=? WHERE id=?",
      ).run(capture.id, id);
      return { invoice: dto(read(id)) };
    });
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
      db.prepare(
        "UPDATE fairshare_invoices SET status='PUBLISHING' WHERE id=?",
      ).run(op.id);
      const published = await provider().publishInvoice(
        draft.id,
        `publish-${op.id}`,
      );
      check(read(op.id), published);
      db.prepare(
        "UPDATE fairshare_invoices SET status=?,share_url=? WHERE id=?",
      ).run(
        published.shareUrl ? "SHARED" : "PAYMENT_PENDING",
        published.shareUrl,
        op.id,
      );
      return { invoice: dto(read(op.id)) };
    } catch (error) {
      db.prepare(
        "UPDATE fairshare_invoices SET status='UNKNOWN' WHERE id=?",
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
    discover: () =>
      (
        db
          .prepare(
            "SELECT id FROM fairshare_invoices WHERE provider_id IS NOT NULL AND status NOT IN ('PAID','CREATING')",
          )
          .all() as { id: string }[]
      ).map((r) => ({ kind: "INVOICE", id: r.id })),
  };
}
