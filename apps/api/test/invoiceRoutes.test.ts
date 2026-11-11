import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { AggregateStore } from "../src/fairshare.js";
import {
  createCollaboration,
  proposeVersion,
  sendForReview,
  approveVersion,
  activateVersion,
  MemberRole,
  RuleOrigin,
  FeePolicy,
} from "@fairshare/domain";
import { PayPalError } from "@fairshare/payments";
import type { PaymentProvider } from "../src/paymentRoutes.js";
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
async function setup(reconciliation = false) {
  let writes = 0,
    captures = 0,
    payoutWrites = 0,
    reference = "",
    signature = true,
    fee = true;
  const capture = {
    id: "CAP1",
    orderId: "ORDER1",
    reference: "",
    amountCents: 10000,
    currency: "USD",
    status: "COMPLETED",
    accounting: { feeCents: 300, netCents: 9700 },
  };
  const provider: PaymentProvider = {
    createOrder: async (input) => {
      writes++;
      reference = input.reference;
      return {
        id: "ORDER1",
        approvalUrl: "https://www.sandbox.paypal.com/approve",
      };
    },
    captureOrder: async () => {
      captures++;
      return { ...capture, reference };
    },
    getOrder: async () => ({
      status: "COMPLETED",
      capture: {
        ...capture,
        reference,
        accounting: fee ? capture.accounting : undefined,
      },
    }),
    createPayout: async () => {
      payoutWrites++;
      return { batchId: "BATCH1", status: "PENDING" };
    },
    getPayout: async () => ({
      batchId: "BATCH1",
      itemId: "ITEM1",
      status: "SUCCESS",
    }),
    verifyWebhook: async () => signature,
  };
  const app = await buildApp({
    dbPath: ":memory:",
    payment: {
      provider,
      publicOrigin: "https://callbacks.example.test",
      reconciliation: { enabled: reconciliation },
    },
  });
  const owner = app.store.register({
    name: "Maya",
    email: "maya@example.test",
    password: "Correct-Horse-123",
  });
  const other = app.store.register({
    name: "Other",
    email: "other@example.test",
    password: "Correct-Horse-123",
  });
  const w = app.store.createWorkspace(owner.user.id, "Test");
  const agg = new AggregateStore(app.store.db, (f) => app.store.tx(f));
  let c = createCollaboration(
    {
      id: "collab",
      name: "Test",
      members: [
        {
          userId: owner.user.id,
          displayName: "Maya",
          role: MemberRole.ORGANIZER,
        },
      ],
    },
    owner.user.id,
    new Date().toISOString(),
  );
  const rules = {
    currency: "USD" as const,
    feePolicy: FeePolicy.BEFORE_SPLIT,
    shares: [{ userId: owner.user.id, basisPoints: 10000 }],
    source: {
      origin: RuleOrigin.HUMAN_PROPOSAL,
      documentId: "doc",
      clause: "1",
      excerpt: "test",
    },
    unresolvedQuestions: [],
  };
  c = proposeVersion(c, rules, owner.user.id, new Date().toISOString());
  c = sendForReview(c, 1, owner.user.id, new Date().toISOString());
  c = approveVersion(c, 1, owner.user.id, new Date().toISOString());
  c = activateVersion(c, 1, owner.user.id, new Date().toISOString());
  agg.insert(w.id, c);
  const base = `/api/workspaces/${w.id}/collaborations/collab`;
  const post = (suffix: string, payload: any = {}) =>
    app.inject({
      method: "POST",
      url: base + suffix,
      headers: auth(owner.token),
      payload,
    });
  const event = (id: string, type = "PAYMENT.CAPTURE.COMPLETED") =>
    app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: {
        id,
        event_type: type,
        resource: {
          id: "CAP1",
          supplementary_data: { related_ids: { order_id: "ORDER1" } },
        },
      },
    });
  return {
    app,
    owner,
    other,
    w,
    agg,
    base,
    post,
    event,
    provider,
    counts: () => ({ writes, captures, payoutWrites }),
    badSignature: () => {
      signature = false;
    },
    noFee: () => {
      fee = false;
    },
  };
}

const invoiceInput = {
  requestKey: "invoice-1",
  customerEmail: "buyer@example.test",
  customerName: "Buyer",
  description: "Creative services",
  amountCents: 10000,
  currency: "USD",
  dueDate: "2099-12-01",
};
function install(s: Awaited<ReturnType<typeof setup>>) {
  let creates = 0,
    publishes = 0,
    captureReads = 0;
  let evidence: any = {
    id: "INV2-ABCD-EFGH-IJKL-MNOP",
    status: "DRAFT",
    reference: "",
    amountCents: 10000,
    currency: "USD",
    shareUrl: null,
    payments: [],
  };
  Object.assign(s.provider, {
    createInvoice: async (input: any) => {
      creates++;
      evidence.reference = input.reference;
      return { ...evidence };
    },
    publishInvoice: async () => {
      publishes++;
      evidence.status = "SENT";
      evidence.shareUrl =
        "https://www.sandbox.paypal.com/invoice/p/#INV2-ABCD-EFGH-IJKL-MNOP";
      return { ...evidence };
    },
    getInvoice: async () => ({ ...evidence }),
    getCapture: async () => {
      captureReads++;
      return {
        id: "ICAP1",
        status: "COMPLETED",
        amountCents: 10000,
        currency: "USD",
        accounting: { feeCents: 300, netCents: 9700 },
      };
    },
  });
  return { evidence, counts: () => ({ creates, publishes, captureReads }) };
}
test("invoice creation publishes without duplicate writes; key binds all immutable input", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const first = await s.post("/invoices", invoiceInput);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().invoice.status, "SHARED");
    assert.equal(
      (await s.post("/invoices", invoiceInput)).json().invoice.id,
      first.json().invoice.id,
    );
    assert.deepEqual(p.counts(), { creates: 1, publishes: 1, captureReads: 0 });
    assert.notEqual(
      (await s.post("/invoices", { ...invoiceInput, description: "changed" }))
        .statusCode,
      200,
    );
    assert.equal(p.counts().creates, 1);
  } finally {
    await s.app.close();
  }
});
test("publish readback never presents a cancelled invoice link as payable", async () => {
  const s = await setup(),
    p = install(s);
  s.provider.publishInvoice = async () => {
    p.evidence.status = "CANCELLED";
    p.evidence.shareUrl =
      "https://www.sandbox.paypal.com/invoice/p/#INV2-ABCD-EFGH-IJKL-MNOP";
    return { ...p.evidence };
  };
  try {
    assert.equal(
      (await s.post("/invoices", invoiceInput)).json().invoice.status,
      "CANCELLED",
    );
  } finally {
    await s.app.close();
  }
});
test("manual and unsupported buyer-paid invoices are visible without false allocation", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    p.evidence.status = "MARKED_AS_PAID";
    assert.equal(
      (await s.post(`/invoices/${id}/reconcile`)).json().invoice.status,
      "MARKED_AS_PAID",
    );
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
    p.evidence.status = "PAID";
    p.evidence.payments = [
      {
        transactionId: "ICAP1",
        type: "PAYPAL",
        amountCents: 10000,
        currency: "USD",
      },
    ];
    const result = await s.post(`/invoices/${id}/reconcile`);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().invoice.status, "PAYMENT_RECORDED");
    await s.post(`/invoices/${id}/reconcile`);
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
    assert.equal(p.counts().captureReads, 0);
  } finally {
    await s.app.close();
  }
});
test("only provider statuses that remain payable are presented as ready to share", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    for (const [providerStatus, localStatus] of [
      ["SENT", "SHARED"],
      ["UNPAID", "SHARED"],
      ["PAYMENT_PENDING", "PAYMENT_PENDING"],
      ["PARTIALLY_PAID", "PARTIALLY_PAID"],
      ["PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED"],
      ["MARKED_AS_REFUNDED", "MARKED_AS_REFUNDED"],
    ]) {
      p.evidence.status = providerStatus;
      assert.equal(
        (await s.post(`/invoices/${id}/reconcile`)).json().invoice.status,
        localStatus,
      );
    }
  } finally {
    await s.app.close();
  }
});
test("unknown creation is durable and cannot generate a second invoice", async () => {
  const s = await setup(),
    p = install(s);
  let attempts = 0;
  s.provider.createInvoice = async () => {
    attempts++;
    throw Error("network timeout");
  };
  try {
    assert.notEqual((await s.post("/invoices", invoiceInput)).statusCode, 200);
    assert.equal(
      (await s.post("/invoices", invoiceInput)).json().invoice.status,
      "UNKNOWN",
    );
    assert.equal(attempts, 1);
  } finally {
    await s.app.close();
  }
});
test("revoked organizer cannot publish a draft created during an in-flight request", async () => {
  const s = await setup(),
    p = install(s);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => (entered = resolve));
  const create = s.provider.createInvoice!;
  s.provider.createInvoice = async (input) => {
    entered();
    await gate;
    return create(input);
  };
  try {
    const pending = s.post("/invoices", invoiceInput);
    await started;
    const row = s.agg.read(s.w.id, "collab");
    s.agg.update(s.w.id, "collab", row.revision, (agreement) => ({
      ...agreement,
      members: agreement.members.map((member) =>
        member.userId === s.owner.user.id
          ? { ...member, role: MemberRole.COLLABORATOR }
          : member,
      ),
    }));
    release();
    const result = await pending;
    assert.notEqual(result.statusCode, 200);
    assert.equal(p.counts().publishes, 0);
    const stored = s.app.store.db
      .prepare("SELECT provider_id,status FROM fairshare_invoices")
      .get() as any;
    assert.equal(stored.provider_id, "INV2-ABCD-EFGH-IJKL-MNOP");
    assert.equal(stored.status, "UNKNOWN");
  } finally {
    release();
    await s.app.close();
  }
});
test("invalid invoice inputs never issue provider writes", async () => {
  const s = await setup(),
    p = install(s);
  try {
    for (const change of [
      { amountCents: 1.5 },
      { currency: "EUR" },
      { dueDate: "2099-02-30" },
      { dueDate: "2000-01-01" },
      { customerEmail: "broken" },
      { description: "" },
    ]) {
      assert.notEqual(
        (await s.post("/invoices", { ...invoiceInput, ...change })).statusCode,
        200,
      );
    }
    assert.equal(p.counts().creates, 0);
  } finally {
    await s.app.close();
  }
});
test("invoice mutation and listing reject a user outside the workspace", async () => {
  const s = await setup();
  install(s);
  try {
    const created = await s.post("/invoices", invoiceInput);
    for (const [method, path] of [
      ["GET", "/invoices"],
      ["POST", `/invoices/${created.json().invoice.id}/reconcile`],
    ]) {
      const res = await s.app.inject({
        method: method as "GET" | "POST",
        url: s.base + path,
        headers: auth(s.other.token),
      });
      assert.notEqual(res.statusCode, 200);
    }
  } finally {
    await s.app.close();
  }
});
test("publish timeout preserves provider ID and read-only reconciliation recovers link", async () => {
  const s = await setup(),
    p = install(s);
  s.provider.publishInvoice = async () => {
    p.evidence.status = "SENT";
    p.evidence.shareUrl =
      "https://www.sandbox.paypal.com/invoice/p/#INV2-ABCD-EFGH-IJKL-MNOP";
    throw Error("timeout");
  };
  try {
    assert.notEqual((await s.post("/invoices", invoiceInput)).statusCode, 200);
    const prior = (await s.post("/invoices", invoiceInput)).json().invoice;
    assert.equal(prior.status, "UNKNOWN");
    assert.equal(prior.providerId, "INV2-ABCD-EFGH-IJKL-MNOP");
    assert.equal(
      (await s.post(`/invoices/${prior.id}/reconcile`)).json().invoice.status,
      "SHARED",
    );
    assert.equal(p.counts().creates, 1);
  } finally {
    await s.app.close();
  }
});
test("provider invoice identity mismatch cannot be declared paid", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    p.evidence.reference = "someone-else";
    assert.notEqual(
      (await s.post(`/invoices/${id}/reconcile`)).statusCode,
      200,
    );
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
  } finally {
    await s.app.close();
  }
});

function paid(
  s: Awaited<ReturnType<typeof setup>>,
  p: ReturnType<typeof install>,
) {
  p.evidence.status = "PAID";
  p.evidence.paidAmountCents = 10000;
  p.evidence.dueAmountCents = 0;
  p.evidence.payments = [
    {
      transactionId: "ICAP1",
      type: "PAYPAL",
      amountCents: 10000,
      currency: "USD",
      status: "SUCCESS",
      paidDate: "2026-11-11",
    },
  ];
  const settlement: any = {
    id: "ICAP1",
    invoiceId: p.evidence.id,
    status: "COMPLETED",
    amountCents: 10000,
    currency: "USD",
    accounting: { feeCents: 300, netCents: 9700 },
  };
  let reads = 0;
  s.provider.getInvoiceSettlement = async (invoiceId, transactionId) => {
    assert.equal(invoiceId, p.evidence.id);
    assert.equal(transactionId, "ICAP1");
    reads++;
    return structuredClone(settlement);
  };
  return { settlement, reads: () => reads };
}
const invoiceEvent = (
  s: Awaited<ReturnType<typeof setup>>,
  id: string,
  type = "INVOICING.INVOICE.PAID",
) =>
  s.app.inject({
    method: "POST",
    url: "/api/paypal/webhook",
    payload: {
      id,
      event_type: type,
      resource: { id: "INV2-ABCD-EFGH-IJKL-MNOP" },
    },
  });
test("verified invoice settlement allocates actual net once and appears in incoming payments", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    paid(s, p);
    const first = await s.post(`/invoices/${id}/reconcile`);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().invoice.status, "PAID");
    assert.equal(first.json().invoice.settlementStatus, "VERIFIED");
    assert.equal(first.json().invoice.paidAmountCents, 10000);
    assert.equal(first.json().invoice.dueAmountCents, 0);
    assert.equal(first.json().invoice.paidDate, "2026-11-11");
    assert.equal((await invoiceEvent(s, "paid-1")).statusCode, 200);
    assert.equal((await invoiceEvent(s, "paid-1")).statusCode, 200);
    const sale = await s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: {
        id: "invoice-sale-complete",
        event_type: "PAYMENT.SALE.COMPLETED",
        resource: { id: "ICAP1", invoice_number: p.evidence.id },
      },
    });
    assert.equal(sale.statusCode, 200, sale.body);
    for (const related of [
      {},
      { supplementary_data: { related_ids: { order_id: "INVOICEORDER" } } },
    ]) {
      const captureEvent = await s.app.inject({
        method: "POST",
        url: "/api/paypal/webhook",
        payload: {
          id: `invoice-capture-${Object.keys(related).length}`,
          event_type: "PAYMENT.CAPTURE.COMPLETED",
          resource: { id: "ICAP1", invoice_id: p.evidence.id, ...related },
        },
      });
      assert.equal(captureEvent.statusCode, 200, captureEvent.body);
    }
    const revenue = s.agg.read(s.w.id, "collab").value.revenue;
    assert.equal(revenue.length, 1);
    assert.equal(revenue[0].feeCents, 300);
    assert.equal(revenue[0].netCents, 9700);
    const rows = (
      await s.app.inject({
        method: "GET",
        url: s.base + "/payments",
        headers: auth(s.owner.token),
      })
    ).json().payments;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].invoice_id, id);
    assert.equal(rows[0].status, "ALLOCATED");
    assert.equal(s.counts().captures, 0);
    assert.equal(s.counts().payoutWrites, 0);
  } finally {
    await s.app.close();
  }
});
test("verified paid invoices retain their final status when a refresh is weak or adverse", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    paid(s, p);
    assert.equal((await s.post(`/invoices/${id}/reconcile`)).statusCode, 200);
    const pending = paid(s, p);
    pending.settlement.status = "PENDING";
    const weak = await s.post(`/invoices/${id}/reconcile`);
    assert.equal(weak.statusCode, 200, weak.body);
    assert.equal(weak.json().invoice.status, "PAID");
    assert.equal(weak.json().invoice.settlementStatus, "VERIFIED");
    const refreshed = s.app.store.db
      .prepare(
        "SELECT settlement_error,checked_at FROM fairshare_invoices WHERE id=?",
      )
      .get(id) as any;
    assert.equal(refreshed.settlement_error, "INVOICE_SETTLEMENT_PENDING");
    assert.ok(refreshed.checked_at);
    const adverse = paid(s, p);
    adverse.settlement.status = "REFUNDED";
    const held = await s.post(`/invoices/${id}/reconcile`);
    assert.equal(held.statusCode, 200, held.body);
    assert.equal(held.json().invoice.status, "PAID");
    assert.equal(held.json().invoice.settlementStatus, "HELD");
    assert.equal(s.agg.read(s.w.id, "collab").value.reviewHold, true);
    const weakAfterHold = paid(s, p);
    weakAfterHold.settlement.status = "PENDING";
    const retained = await s.post(`/invoices/${id}/reconcile`);
    assert.equal(retained.statusCode, 200, retained.body);
    assert.equal(retained.json().invoice.status, "PAID");
    assert.equal(retained.json().invoice.settlementStatus, "HELD");
    assert.equal(s.agg.read(s.w.id, "collab").value.reviewHold, true);
  } finally {
    await s.app.close();
  }
});
test("missing fee, mismatched identity and unsupported transactions remain retryable without allocation", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    for (const change of [
      { accounting: undefined },
      { invoiceId: "INV2-WRONG-WRONG" },
      { id: "OTHER" },
      { currency: "CAD" },
      { amountCents: 9999 },
      { status: "PENDING" },
      { accounting: { feeCents: 0, netCents: 9999 } },
    ]) {
      const q = paid(s, p);
      Object.assign(q.settlement, change);
      const r = await s.post(`/invoices/${id}/reconcile`);
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(r.json().invoice.status, "PAYMENT_RECORDED");
      assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
    }
    paid(s, p).settlement.accounting = undefined;
    assert.equal((await invoiceEvent(s, "missing-fee")).statusCode, 503);
    paid(s, p);
    assert.equal((await invoiceEvent(s, "missing-fee")).statusCode, 200);
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 1);
  } finally {
    await s.app.close();
  }
});
test("manual, external and partial payments do not enter settlement allocation", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    for (const change of [
      { status: "MARKED_AS_PAID" },
      { status: "PARTIALLY_PAID" },
      {
        payments: [
          {
            transactionId: "ICAP1",
            type: "EXTERNAL",
            amountCents: 10000,
            currency: "USD",
          },
        ],
      },
      {
        payments: [
          {
            transactionId: "ICAP1",
            type: "PAYPAL",
            amountCents: 100,
            currency: "USD",
          },
        ],
      },
    ]) {
      const q = paid(s, p);
      Object.assign(p.evidence, change);
      await s.post(`/invoices/${id}/reconcile`);
      assert.equal(q.reads(), 0);
      assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
    }
  } finally {
    await s.app.close();
  }
});
test("refunded invoice holds historical allocation and a later paid read cannot release the hold", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    paid(s, p);
    await s.post(`/invoices/${id}/reconcile`);
    p.evidence.status = "REFUNDED";
    assert.equal(
      (await invoiceEvent(s, "invoice-refund", "INVOICING.INVOICE.REFUNDED"))
        .statusCode,
      200,
    );
    let value = s.agg.read(s.w.id, "collab").value;
    assert.equal(value.reviewHold, true);
    assert.equal(value.revenue[0].netCents, 9700);
    assert.equal(value.revenue[0].allocations[0].status, "HELD");
    paid(s, p);
    const r = await s.post(`/invoices/${id}/reconcile`);
    assert.equal(r.json().invoice.settlementStatus, "HELD");
    value = s.agg.read(s.w.id, "collab").value;
    assert.equal(value.reviewHold, true);
    assert.equal(value.revenue.length, 1);
  } finally {
    await s.app.close();
  }
});
test("invoice allocation rejects another payment's capture and changed rule versions", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    paid(s, p);
    s.app.store.db
      .prepare("INSERT INTO fairshare_captures VALUES(?,?,?)")
      .run("ICAP1", s.w.id, "collab");
    let r = await s.post(`/invoices/${id}/reconcile`);
    assert.equal(r.json().invoice.settlementError, "CAPTURE_ALREADY_USED");
    s.app.store.db
      .prepare(
        "DELETE FROM fairshare_captures WHERE provider_capture_id='ICAP1'",
      )
      .run();
    s.app.store.db
      .prepare("UPDATE fairshare_invoices SET version_id=999 WHERE id=?")
      .run(id);
    r = await s.post(`/invoices/${id}/reconcile`);
    assert.equal(r.json().invoice.settlementError, "PAYMENT_RULES_CHANGED");
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
  } finally {
    await s.app.close();
  }
});

test("an invoice refund before allocation remains a durable hold after the event is done", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    p.evidence.status = "REFUNDED";
    assert.equal(
      (await invoiceEvent(s, "refund-first", "INVOICING.INVOICE.REFUNDED"))
        .statusCode,
      200,
    );
    paid(s, p);
    const r = await s.post(`/invoices/${id}/reconcile`);
    assert.equal(r.json().invoice.settlementStatus, "HELD");
    assert.equal(r.json().invoice.settlementError, "PAYMENT_HOLD");
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
  } finally {
    await s.app.close();
  }
});
test("partial invoice receipt reports actual paid amount rather than original total", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    p.evidence.status = "PARTIALLY_PAID";
    p.evidence.paidAmountCents = 2500;
    p.evidence.dueAmountCents = 7500;
    await s.post(`/invoices/${id}/reconcile`);
    const r = await s.app.inject({
      method: "GET",
      url: s.base + "/payments",
      headers: auth(s.owner.token),
    });
    assert.equal(r.json().payments[0].amount, 2500);
    assert.equal(r.json().payments[0].status, "PAYMENT_PENDING");
  } finally {
    await s.app.close();
  }
});
test("stale concurrent paid read cannot overwrite an invoice refund tombstone", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    const q = paid(s, p);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    s.provider.getInvoiceSettlement = async () => {
      started();
      await blocked;
      return q.settlement;
    };
    const pending = s
      .post(`/invoices/${id}/reconcile`)
      .then((response) => response);
    await reading;
    p.evidence.status = "REFUNDED";
    assert.equal(
      (await invoiceEvent(s, "concurrent-refund", "INVOICING.INVOICE.REFUNDED"))
        .statusCode,
      200,
    );
    release();
    assert.notEqual((await pending).statusCode, 200);
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
    const row = s.app.store.db
      .prepare(
        "SELECT status,settlement_status FROM fairshare_invoices WHERE id=?",
      )
      .get(id) as any;
    assert.equal(row.status, "REFUNDED");
    assert.equal(row.settlement_status, "HELD");
  } finally {
    await s.app.close();
  }
});
test("capture reversal holds the invoice receipt and verified allocation together", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    paid(s, p);
    await s.post(`/invoices/${id}/reconcile`);
    const r = await s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: {
        id: "invoice-capture-reversed",
        event_type: "PAYMENT.CAPTURE.REVERSED",
        resource: { id: "ICAP1" },
      },
    });
    assert.equal(r.statusCode, 200, r.body);
    const invoices = (
      await s.app.inject({
        method: "GET",
        url: s.base + "/invoices",
        headers: auth(s.owner.token),
      })
    ).json().invoices;
    assert.equal(invoices[0].settlementStatus, "HELD");
    const payments = (
      await s.app.inject({
        method: "GET",
        url: s.base + "/payments",
        headers: auth(s.owner.token),
      })
    ).json().payments;
    assert.equal(payments[0].status, "HELD");
    assert.equal(s.agg.read(s.w.id, "collab").value.reviewHold, true);
  } finally {
    await s.app.close();
  }
});
