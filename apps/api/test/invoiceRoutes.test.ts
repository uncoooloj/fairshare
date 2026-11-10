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
    publishes = 0;
  let evidence: any = {
    id: "INV1",
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
      evidence.shareUrl = "https://www.sandbox.paypal.com/invoice/p/#INV1";
      return { ...evidence };
    },
    getInvoice: async () => ({ ...evidence }),
    getCapture: async () => ({
      id: "ICAP1",
      status: "COMPLETED",
      amountCents: 10000,
      currency: "USD",
      accounting: { feeCents: 300, netCents: 9700 },
    }),
  });
  return { evidence, counts: () => ({ creates, publishes }) };
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
    assert.deepEqual(p.counts(), { creates: 1, publishes: 1 });
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
test("manual marked invoice never allocates; confirmed capture allocates once", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    p.evidence.status = "MARKED_AS_PAID";
    assert.equal(
      (await s.post(`/invoices/${id}/reconcile`)).json().invoice.status,
      "PAYMENT_PENDING",
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
    assert.equal(result.json().invoice.status, "PAID");
    await s.post(`/invoices/${id}/reconcile`);
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 1);
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
test("paid invoice without fee proof or mismatched transaction never allocates", async () => {
  const s = await setup(),
    p = install(s);
  try {
    const id = (await s.post("/invoices", invoiceInput)).json().invoice.id;
    p.evidence.status = "PAID";
    p.evidence.payments = [
      {
        transactionId: "ICAP1",
        type: "PAYPAL",
        amountCents: 10000,
        currency: "USD",
      },
    ];
    s.provider.getCapture = async () => ({
      id: "ICAP1",
      status: "COMPLETED",
      amountCents: 10000,
      currency: "USD",
    });
    assert.notEqual(
      (await s.post(`/invoices/${id}/reconcile`)).statusCode,
      200,
    );
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
  } finally {
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
    p.evidence.shareUrl = "https://www.sandbox.paypal.com/invoice/p/#INV1";
    throw Error("timeout");
  };
  try {
    assert.notEqual((await s.post("/invoices", invoiceInput)).statusCode, 200);
    const prior = (await s.post("/invoices", invoiceInput)).json().invoice;
    assert.equal(prior.status, "UNKNOWN");
    assert.equal(prior.providerId, "INV1");
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
