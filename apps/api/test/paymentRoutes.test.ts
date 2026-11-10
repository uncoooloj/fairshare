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
test("provider-confirmed capture allocates once, uses net fees and immutable checkout keys", async () => {
  const s = await setup();
  try {
    let r = await s.post("/payments", {
      amountCents: 10000,
      requestKey: "one",
    });
    assert.equal(r.statusCode, 200, r.body);
    const id = r.json().id;
    assert.equal(
      (await s.post("/payments", { amountCents: 10001, requestKey: "one" }))
        .statusCode,
      400,
    );
    await s.post("/payments", { amountCents: 10000, requestKey: "one" });
    assert.equal(s.counts().writes, 1);
    r = await s.post(`/payments/${id}/capture`);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().confirmed, true);
    await s.post(`/payments/${id}/capture`);
    assert.equal(s.counts().captures, 1);
    const c = s.agg.read(s.w.id, "collab").value;
    assert.equal(c.revenue.length, 1);
    assert.equal(c.revenue[0].allocations[0].totalCents, 9700);
    assert.equal(
      (
        await s.app.inject({
          url: s.base + "/payments",
          headers: auth(s.other.token),
        })
      ).statusCode,
      404,
    );
  } finally {
    await s.app.close();
  }
});
test("duplicate signed webhook produces one allocation; invalid and altered events fail", async () => {
  const s = await setup();
  try {
    await s.post("/payments", { amountCents: 10000, requestKey: "one" });
    assert.equal((await s.event("evt1")).statusCode, 200);
    assert.equal((await s.event("evt1")).statusCode, 200);
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 1);
    assert.equal(
      (await s.event("evt1", "PAYMENT.CAPTURE.REVERSED")).statusCode,
      400,
    );
    s.badSignature();
    assert.equal((await s.event("bad")).statusCode, 401);
  } finally {
    await s.app.close();
  }
});
test("missing fee accounting cannot silently allocate zero-fee revenue", async () => {
  const s = await setup();
  try {
    const id = (
      await s.post("/payments", { amountCents: 10000, requestKey: "one" })
    ).json().id;
    s.noFee();
    assert.equal((await s.post(`/payments/${id}/capture`)).statusCode, 400);
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
  } finally {
    await s.app.close();
  }
});
test("payout dispatch uses exact allocation once and reversal blocks further dispatch", async () => {
  const s = await setup();
  try {
    const id = (
      await s.post("/payments", { amountCents: 10000, requestKey: "one" })
    ).json().id;
    await s.post(`/payments/${id}/capture`);
    assert.equal(
      (await s.post("/payouts/dispatch", { captureId: "CAP1" })).statusCode,
      400,
    );
    await s.app.inject({
      method: "PUT",
      url: s.base + "/recipient",
      headers: auth(s.owner.token),
      payload: { paypalId: "ABCDEFGHIJKLM" },
    });
    let r = await s.post("/payouts/dispatch", { captureId: "CAP1" });
    assert.equal(r.statusCode, 200, r.body);
    const payoutId = r.json().payouts[0].id;
    assert.equal(r.json().payouts[0].status, "PENDING");
    await s.post("/payouts/dispatch", { captureId: "CAP1" });
    assert.equal(s.counts().payoutWrites, 1);
    r = await s.post(`/payouts/${payoutId}/reconcile`);
    assert.equal(r.json().status, "SUCCESS");
    assert.equal(
      (await s.event("reversal", "PAYMENT.CAPTURE.REVERSED")).statusCode,
      200,
    );
    assert.equal(
      (await s.post("/payouts/dispatch", { captureId: "CAP1" })).statusCode,
      400,
    );
    assert.equal(s.agg.read(s.w.id, "collab").value.reviewHold, true);
  } finally {
    await s.app.close();
  }
});
test("uncertain create is reserved and not automatically replayed", async () => {
  const s = await setup();
  try {
    s.provider.createOrder = async () => {
      throw new PayPalError("PAYPAL_OUTCOME_UNKNOWN");
    };
    await s.post("/payments", { amountCents: 10000, requestKey: "one" });
    const r = await s.post("/payments", {
      amountCents: 10000,
      requestKey: "one",
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().status, "OUTCOME_UNKNOWN");
  } finally {
    await s.app.close();
  }
});
test("reversal before capture blocks subsequent allocation and retains event", async () => {
  const s = await setup();
  try {
    const id = (
      await s.post("/payments", { amountCents: 10000, requestKey: "one" })
    ).json().id;
    assert.equal(
      (await s.event("reverse-first", "PAYMENT.CAPTURE.REVERSED")).statusCode,
      503,
    );
    const r = await s.post(`/payments/${id}/capture`);
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
  } finally {
    await s.app.close();
  }
});

test("unknown completed order recovery verifies evidence without replaying create/capture", async () => {
  const s = await setup();
  try {
    s.provider.createOrder = async (input) => {
      throw new PayPalError("PAYPAL_OUTCOME_UNKNOWN");
    };
    await s.post("/payments", { amountCents: 10000, requestKey: "one" });
    const op = (
      await s.post("/payments", { amountCents: 10000, requestKey: "one" })
    ).json();
    s.provider.getOrder = async () => ({
      status: "COMPLETED",
      capture: {
        id: "CAP1",
        orderId: "RECOVER1",
        reference: op.id,
        amountCents: 10000,
        currency: "USD",
        status: "COMPLETED",
        accounting: { feeCents: 300, netCents: 9700 },
      },
    });
    const r = await s.post(`/payments/${op.id}/recover`, {
      providerOrderId: "RECOVER1",
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().confirmed, true);
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 1);
    assert.equal(s.counts().captures, 0);
    assert.equal(
      (
        await s.post(`/payments/${op.id}/recover`, {
          providerOrderId: "RECOVER1",
        })
      ).statusCode,
      200,
    );
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 1);
    assert.equal(
      (await s.post(`/payments/${op.id}/recover`, { providerOrderId: "OTHER" }))
        .statusCode,
      400,
    );
  } finally {
    await s.app.close();
  }
});
test("unmatched or uncompleted recovery evidence is rejected and cannot leak tenant data", async () => {
  const s = await setup();
  try {
    s.provider.createOrder = async () => {
      throw new PayPalError("PAYPAL_OUTCOME_UNKNOWN");
    };
    await s.post("/payments", { amountCents: 10000, requestKey: "one" });
    const op = (
      await s.post("/payments", { amountCents: 10000, requestKey: "one" })
    ).json();
    s.provider.getOrder = async () => ({ status: "CREATED", capture: null });
    assert.equal(
      (await s.post(`/payments/${op.id}/recover`, { providerOrderId: "O1" }))
        .statusCode,
      400,
    );
    s.provider.getOrder = async () => ({
      status: "COMPLETED",
      capture: {
        id: "CAP1",
        orderId: "O1",
        reference: "WRONG",
        amountCents: 10000,
        currency: "USD",
        status: "COMPLETED",
      },
    });
    assert.notEqual(
      (await s.post(`/payments/${op.id}/recover`, { providerOrderId: "O1" }))
        .statusCode,
      200,
    );
    const r = await s.app.inject({
      url: s.base + "/recovery",
      headers: auth(s.other.token),
    });
    assert.equal(r.statusCode, 404);
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
  } finally {
    await s.app.close();
  }
});
async function refundable(reconciliation = false) {
  const s = await setup(reconciliation);
  const id = (
    await s.post("/payments", { amountCents: 10000, requestKey: "one" })
  ).json().id;
  await s.post(`/payments/${id}/capture`);
  let refunds = 0,
    request = "";
  s.provider.refundCapture = async (captureId, amount, currency, key) => {
    refunds++;
    assert.equal(captureId, "CAP1");
    assert.equal(amount, 10000);
    request = key;
    return { id: "REF1", status: "COMPLETED", amountCents: amount, currency };
  };
  s.provider.getRefund = async (refundId) => ({
    id: refundId,
    status: "COMPLETED",
    amountCents: 10000,
    currency: "USD",
    captureId: "CAP1",
    reference: request,
  });
  return { ...s, paymentId: id, refundCount: () => refunds };
}
test("full original refund is durable exactly-once and holds liabilities without editing agreed split", async () => {
  const s = await refundable();
  try {
    const before = s.agg.read(s.w.id, "collab").value.revenue[0].allocations[0]
      .totalCents;
    const r = await s.post(`/payments/${s.paymentId}/refund`, {
      confirmFullRefund: true,
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().status, "COMPLETED");
    assert.equal(r.json().holdRemains, true);
    assert.equal(
      (
        await s.post(`/payments/${s.paymentId}/refund`, {
          confirmFullRefund: true,
        })
      ).statusCode,
      200,
    );
    assert.equal(s.refundCount(), 1);
    const c = s.agg.read(s.w.id, "collab").value;
    assert.equal(c.reviewHold, true);
    assert.equal(c.revenue[0].allocations[0].totalCents, before);
    assert.equal(
      (await s.post("/payouts/dispatch", { captureId: "CAP1" })).statusCode,
      400,
    );
    const recovery = (
      await s.app.inject({
        url: s.base + "/recovery",
        headers: auth(s.owner.token),
      })
    ).json();
    assert.equal(recovery.refunds.length, 1);
    assert.ok(
      recovery.audit.some((e: any) => e.kind === "REFUND_EVIDENCE_VERIFIED"),
    );
  } finally {
    await s.app.close();
  }
});
test("refund requires explicit confirmation and rejects arbitrary amounts or reserved payout liabilities", async () => {
  const s = await refundable();
  try {
    assert.equal(
      (await s.post(`/payments/${s.paymentId}/refund`)).statusCode,
      400,
    );
    assert.equal(
      (
        await s.post(`/payments/${s.paymentId}/refund`, {
          confirmFullRefund: true,
          amountCents: 1,
        })
      ).statusCode,
      400,
    );
    await s.app.inject({
      method: "PUT",
      url: s.base + "/recipient",
      headers: auth(s.owner.token),
      payload: { paypalId: "ABCDEFGHIJKLM" },
    });
    await s.post("/payouts/dispatch", { captureId: "CAP1" });
    const r = await s.post(`/payments/${s.paymentId}/refund`, {
      confirmFullRefund: true,
    });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(s.refundCount(), 0);
  } finally {
    await s.app.close();
  }
});
test("unknown refund never replays and can recover only exact refund/capture/request evidence", async () => {
  const s = await refundable();
  try {
    let attempts = 0,
      key = "";
    s.provider.refundCapture = async (_c, _a, _cur, k) => {
      attempts++;
      key = k;
      throw new PayPalError("PAYPAL_OUTCOME_UNKNOWN");
    };
    const r = await s.post(`/payments/${s.paymentId}/refund`, {
      confirmFullRefund: true,
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().status, "OUTCOME_UNKNOWN");
    const refundId = r.json().id;
    await s.post(`/payments/${s.paymentId}/refund`, {
      confirmFullRefund: true,
    });
    assert.equal(attempts, 1);
    s.provider.getRefund = async (id) => ({
      id,
      status: "COMPLETED",
      amountCents: 10000,
      currency: "USD",
      captureId: "OTHER",
      reference: key,
    });
    assert.equal(
      (
        await s.post(`/refunds/${refundId}/recover`, {
          providerRefundId: "REF1",
        })
      ).statusCode,
      400,
    );
    s.provider.getRefund = async (id) => ({
      id,
      status: "COMPLETED",
      amountCents: 10000,
      currency: "USD",
      captureId: "CAP1",
      reference: key,
    });
    const recovered = await s.post(`/refunds/${refundId}/recover`, {
      providerRefundId: "REF1",
    });
    assert.equal(recovered.statusCode, 200, recovered.body);
    assert.equal(recovered.json().status, "COMPLETED");
    assert.equal(attempts, 1);
    assert.equal(s.agg.read(s.w.id, "collab").value.reviewHold, true);
  } finally {
    await s.app.close();
  }
});
test("refund reservation blocks concurrent payout while provider write is in flight", async () => {
  const s = await refundable();
  try {
    let release!: () => void, started!: () => void;
    const began = new Promise<void>((r) => (started = r));
    const waiting = new Promise<void>((r) => (release = r));
    const old = s.provider.refundCapture!;
    s.provider.refundCapture = async (...args) => {
      started();
      await waiting;
      return old(...args);
    };
    const pending = s.post(`/payments/${s.paymentId}/refund`, {
      confirmFullRefund: true,
    });
    await began;
    const payout = await s.post("/payouts/dispatch", { captureId: "CAP1" });
    assert.equal(payout.statusCode, 400);
    release();
    assert.equal((await pending).statusCode, 200);
    assert.equal(s.counts().payoutWrites, 0);
  } finally {
    await s.app.close();
  }
});
test("unknown payout recovery is read-only, adapter verifies frozen operation and status", async () => {
  const s = await setup();
  try {
    const id = (
      await s.post("/payments", { amountCents: 10000, requestKey: "one" })
    ).json().id;
    await s.post(`/payments/${id}/capture`);
    await s.app.inject({
      method: "PUT",
      url: s.base + "/recipient",
      headers: auth(s.owner.token),
      payload: { paypalId: "ABCDEFGHIJKLM" },
    });
    let writes = 0;
    s.provider.createPayout = async () => {
      writes++;
      throw new PayPalError("PAYPAL_OUTCOME_UNKNOWN");
    };
    const payout = (
      await s.post("/payouts/dispatch", { captureId: "CAP1" })
    ).json().payouts[0];
    s.provider.getPayout = async (batch, expected) => {
      assert.equal(expected.requestId, payout.id);
      assert.equal(expected.amountCents, 9700);
      assert.equal(expected.recipientId, "ABCDEFGHIJKLM");
      return { batchId: batch, itemId: "ITEM1", status: "SUCCESS" };
    };
    const r = await s.post(`/payouts/${payout.id}/recover`, {
      providerBatchId: "BATCH1",
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().status, "SUCCESS");
    assert.equal(writes, 1);
    await s.post("/payouts/dispatch", { captureId: "CAP1" });
    assert.equal(writes, 1);
  } finally {
    await s.app.close();
  }
});

test("capture does not charge a buyer after agreement is held or approved rules changed", async () => {
  for (const reason of ["hold", "version"] as const) {
    const s = await setup();
    try {
      const id = (
        await s.post("/payments", { amountCents: 10000, requestKey: "one" })
      ).json().id;
      const row = s.agg.read(s.w.id, "collab");
      s.agg.update(s.w.id, "collab", row.revision, (c) => ({
        ...c,
        ...(reason === "hold" ? { reviewHold: true } : { activeVersionId: 2 }),
      }));
      const r = await s.post(`/payments/${id}/capture`);
      assert.equal(r.statusCode, 400, r.body);
      assert.equal(
        s.counts().captures,
        0,
        "must block before provider capture",
      );
      assert.equal(
        (
          s.app.store.db
            .prepare("SELECT status FROM fairshare_payment_ops WHERE id=?")
            .get(id) as any
        ).status,
        "AWAITING_BUYER",
      );
    } finally {
      await s.app.close();
    }
  }
});
test("capture does not issue provider write after matched adverse webhook arrived first", async () => {
  const s = await setup();
  try {
    const id = (
      await s.post("/payments", { amountCents: 10000, requestKey: "one" })
    ).json().id;
    await s.event("known-adverse", "PAYMENT.CAPTURE.REVERSED");
    const r = await s.post(`/payments/${id}/capture`);
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(s.counts().captures, 0);
  } finally {
    await s.app.close();
  }
});
test("unrelated adverse provider event does not block an otherwise valid capture", async () => {
  const s = await setup();
  try {
    const id = (
      await s.post("/payments", { amountCents: 10000, requestKey: "one" })
    ).json().id;
    await s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: {
        id: "unrelated",
        event_type: "PAYMENT.CAPTURE.REVERSED",
        resource: {
          id: "OTHER_CAP",
          supplementary_data: { related_ids: { order_id: "OTHER_ORDER" } },
        },
      },
    });
    const r = await s.post(`/payments/${id}/capture`);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(s.counts().captures, 1);
  } finally {
    await s.app.close();
  }
});

test("background reconciliation reads known orders exactly once and never captures or dispatches money", async () => {
  const s = await setup(true);
  try {
    const op = (
      await s.post("/payments", { amountCents: 10000, requestKey: "worker" })
    ).json();
    await (s.app as any).paymentReconciliation.tick();
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 1);
    assert.equal(s.counts().captures, 0);
    assert.equal(s.counts().payoutWrites, 0);
    await (s.app as any).paymentReconciliation.tick();
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 1);
    assert.equal(
      (
        s.app.store.db
          .prepare("SELECT status FROM fairshare_payment_ops WHERE id=?")
          .get(op.id) as any
      ).status,
      "ALLOCATED",
    );
  } finally {
    await s.app.close();
  }
});
test("background reconciliation never retries unknown writes without provider IDs", async () => {
  const s = await setup(true);
  try {
    s.provider.createOrder = async () => {
      throw new Error("uncertain");
    };
    await s.post("/payments", {
      amountCents: 10000,
      requestKey: "unknown-worker",
    });
    let reads = 0;
    s.provider.getOrder = async () => {
      reads++;
      throw new Error("must not read without ID");
    };
    await (s.app as any).paymentReconciliation.tick();
    assert.equal(reads, 0);
    assert.equal(s.counts().captures, 0);
    assert.equal(s.counts().payoutWrites, 0);
  } finally {
    await s.app.close();
  }
});

test("worker verifies payout and refund evidence, preserves refund hold and rejects mismatched refunds", async () => {
  const s = await refundable(true);
  try {
    const original = s.provider.getRefund!;
    s.provider.getRefund = async (id) => ({
      ...(await original(id)),
      status: "PENDING",
    });
    const r = await s.post(`/payments/${s.paymentId}/refund`, {
      confirmFullRefund: true,
    });
    assert.equal(r.statusCode, 200, r.body);
    s.provider.getRefund = async (id) => ({
      ...(await original(id)),
      amountCents: 1,
    });
    await (s.app as any).paymentReconciliation.tick();
    assert.equal(
      (
        s.app.store.db
          .prepare("SELECT status FROM fairshare_refund_ops")
          .get() as any
      ).status,
      "PENDING",
    );
    s.provider.getRefund = original;
    s.app.store.db
      .prepare("UPDATE fairshare_reconciliation_jobs SET next_run=0")
      .run();
    await (s.app as any).paymentReconciliation.tick();
    assert.equal(
      (
        s.app.store.db
          .prepare("SELECT status FROM fairshare_refund_ops")
          .get() as any
      ).status,
      "COMPLETED",
    );
    assert.equal(s.refundCount(), 1);
    assert.equal(s.agg.read(s.w.id, "collab").value.reviewHold, true);
  } finally {
    await s.app.close();
  }
  const p = await setup(true);
  try {
    const id = (
      await p.post("/payments", {
        amountCents: 10000,
        requestKey: "payout-worker",
      })
    ).json().id;
    await p.post(`/payments/${id}/capture`);
    await p.app.inject({
      method: "PUT",
      url: p.base + "/recipient",
      headers: auth(p.owner.token),
      payload: { paypalId: "ABCDEFGHIJKLM" },
    });
    await p.post("/payouts/dispatch", { captureId: "CAP1" });
    await (p.app as any).paymentReconciliation.tick();
    assert.equal(
      (
        p.app.store.db
          .prepare("SELECT status FROM fairshare_payout_ops")
          .get() as any
      ).status,
      "SUCCESS",
    );
    assert.equal(p.counts().payoutWrites, 1);
  } finally {
    await p.app.close();
  }
});
test("worker retries signed pending event but cannot allocate held capture", async () => {
  const s = await setup(true);
  try {
    const id = (
      await s.post("/payments", {
        amountCents: 10000,
        requestKey: "held-worker",
      })
    ).json().id;
    await s.event("worker-adverse", "PAYMENT.CAPTURE.REVERSED");
    await (s.app as any).paymentReconciliation.tick();
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
    assert.equal(s.counts().captures, 0);
    assert.equal(
      (
        s.app.store.db
          .prepare("SELECT status FROM fairshare_webhook_inbox WHERE id=?")
          .get("worker-adverse") as any
      ).status,
      "PENDING",
    );
  } finally {
    await s.app.close();
  }
});
test("scheduler refuses DEMO or missing provider configuration", async () => {
  await assert.rejects(
    buildApp({
      dbPath: ":memory:",
      demo: true,
      payment: { reconciliation: { enabled: true } },
    }),
    /SANDBOX/,
  );
  await assert.rejects(
    buildApp({
      dbPath: ":memory:",
      payment: { reconciliation: { enabled: true } },
    }),
    /SANDBOX/,
  );
});
