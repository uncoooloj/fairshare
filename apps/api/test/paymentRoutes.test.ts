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
import { PayPalError, PayPalSandbox, RecipientType } from "@fairshare/payments";
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
      url: "/api/auth/payout-account",
      headers: auth(s.owner.token),
      payload: { email: " Owner.Pay@Example.test " },
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
async function pendingRefund() {
  const s = await refundable(true);
  const original = s.provider.getRefund!;
  s.provider.getRefund = async (id) => ({
    ...(await original(id)),
    status: "PENDING",
  });
  const response = await s.post(`/payments/${s.paymentId}/refund`, {
    confirmFullRefund: true,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().status, "PENDING");
  return { ...s, original, refundId: response.json().id as string };
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
      url: "/api/auth/payout-account",
      headers: auth(s.owner.token),
      payload: { email: " Owner.Pay@Example.test " },
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
test("worker stale pending refund evidence cannot overwrite manual terminal recovery", async () => {
  for (const status of ["FAILED", "CANCELLED"]) {
    const s = await pendingRefund();
    try {
      const origin = await s.app.listen({ host: "127.0.0.1", port: 0 });
      let release!: () => void, started!: () => void;
      const waiting = new Promise<void>((resolve) => (release = resolve));
      const began = new Promise<void>((resolve) => (started = resolve));
      s.provider.getRefund = async (id) => {
        started();
        await waiting;
        return { ...(await s.original(id)), status: "PENDING" };
      };
      const worker = (s.app as any).paymentReconciliation.tick();
      await began;
      s.provider.getRefund = async (id) => ({
        ...(await s.original(id)),
        status,
      });
      const recovered = await fetch(
        `${origin}${s.base}/refunds/${s.refundId}/reconcile`,
        { method: "POST", headers: auth(s.owner.token) },
      );
      assert.equal(recovered.status, 200);
      assert.equal(((await recovered.json()) as any).status, status);
      release();
      await worker;
      assert.equal(
        (
          s.app.store.db
            .prepare("SELECT status FROM fairshare_refund_ops WHERE id=?")
            .get(s.refundId) as any
        ).status,
        status,
      );
    } finally {
      await s.app.close();
    }
  }
});
test("manual stale pending refund evidence cannot overwrite worker terminal recovery", async () => {
  for (const status of ["FAILED", "CANCELLED"]) {
    const s = await pendingRefund();
    try {
      let release!: () => void, started!: () => void;
      const waiting = new Promise<void>((resolve) => (release = resolve));
      const began = new Promise<void>((resolve) => (started = resolve));
      s.provider.getRefund = async (id) => {
        started();
        await waiting;
        return { ...(await s.original(id)), status: "PENDING" };
      };
      const recovery = s.post(`/refunds/${s.refundId}/reconcile`);
      await began;
      s.provider.getRefund = async (id) => ({
        ...(await s.original(id)),
        status,
      });
      await (s.app as any).paymentReconciliation.tick();
      release();
      assert.equal((await recovery).statusCode, 400);
      assert.equal(
        (
          s.app.store.db
            .prepare("SELECT status FROM fairshare_refund_ops WHERE id=?")
            .get(s.refundId) as any
        ).status,
        status,
      );
    } finally {
      await s.app.close();
    }
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
      url: "/api/auth/payout-account",
      headers: auth(s.owner.token),
      payload: { email: " Owner.Pay@Example.test " },
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
      assert.equal(expected.recipientId, "owner.pay@example.test");
      assert.equal(expected.recipientType, RecipientType.EMAIL);
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
test("concurrent webhook processing cannot restore PENDING after another caller finishes", async () => {
  const s = await setup();
  try {
    await s.post("/payments", { amountCents: 10000, requestKey: "race" });
    const getOrder = s.provider.getOrder;
    let calls = 0;
    let firstStarted!: () => void;
    let secondStarted!: () => void;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const secondStartedPromise = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondRelease = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    s.provider.getOrder = async () => {
      calls++;
      if (calls === 1) {
        firstStarted();
        await firstRelease;
        return getOrder("ORDER1");
      }
      secondStarted();
      await secondRelease;
      throw new PayPalError("PAYPAL_OUTCOME_UNKNOWN");
    };
    const payload = {
      id: "concurrent-completed",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAP1",
        supplementary_data: { related_ids: { order_id: "ORDER1" } },
      },
    };
    const first = s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload,
    });
    await firstStartedPromise;
    const second = s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload,
    });
    await secondStartedPromise;
    releaseFirst();
    assert.equal((await first).statusCode, 200);
    releaseSecond();
    assert.equal((await second).statusCode, 200);
    const receipt = s.app.store.db
      .prepare("SELECT status,error FROM fairshare_webhook_inbox WHERE id=?")
      .get(payload.id) as any;
    assert.equal(receipt.status, "DONE");
    assert.equal(receipt.error, null);
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
      url: "/api/auth/payout-account",
      headers: auth(p.owner.token),
      payload: { email: " Owner.Pay@Example.test " },
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

test("source metadata persists without inventing payment confirmation and is immutable per request key", async () => {
  const s = await setup();
  try {
    const request = {
      amountCents: 10000,
      requestKey: "source-other",
      source: { type: "OTHER", name: " Bandcamp " },
    };
    const created = await s.post("/payments", request);
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().source_type, "OTHER");
    assert.equal(created.json().source_name, "Bandcamp");
    assert.equal(created.json().status, "AWAITING_BUYER");
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
    assert.equal(
      (
        await s.post("/payments", {
          ...request,
          source: { type: "OTHER", name: "Bandcamp" },
        })
      ).json().id,
      created.json().id,
    );
    assert.equal(s.counts().writes, 1);
    assert.equal(
      (
        await s.post("/payments", {
          ...request,
          source: { type: "OTHER", name: "Changed" },
        })
      ).json().error.code,
      "IDEMPOTENCY_CONFLICT",
    );
    assert.equal(
      (
        await s.post("/payments", {
          amountCents: 10000,
          requestKey: "source-other",
        })
      ).json().error.code,
      "IDEMPOTENCY_CONFLICT",
    );
    const listing = await s.app.inject({
      url: s.base + "/payments",
      headers: auth(s.owner.token),
    });
    assert.equal(listing.json().payments[0].source_name, "Bandcamp");
    assert.equal(
      (
        await s.app.inject({
          url: s.base + "/payments",
          headers: auth(s.other.token),
        })
      ).statusCode,
      404,
    );
    assert.equal(s.counts().writes, 1);
    assert.equal(s.counts().captures, 0);
  } finally {
    await s.app.close();
  }
});
test("invalid source metadata cannot issue a provider write or assert financial status", async () => {
  const s = await setup();
  try {
    for (const source of [
      null,
      [],
      {},
      "Other",
      { type: "STRIPE" },
      { type: "OTHER", name: "" },
      { type: "OTHER", name: "  " },
      { type: "OTHER", name: "a".repeat(101) },
      { type: "OTHER", name: "bad\nname" },
      { type: "PAYPAL", name: "Bank" },
      { type: "OTHER", name: "Bandcamp", status: "COMPLETED" },
    ]) {
      const r = await s.post("/payments", {
        amountCents: 10000,
        requestKey: "invalid-source",
        source,
      });
      assert.equal(r.statusCode, 400, r.body);
      assert.equal(r.json().error.code, "INVALID_PAYMENT_SOURCE");
    }
    assert.equal(s.counts().writes, 0);
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 0);
    const legacy = await s.post("/payments", {
      amountCents: 10000,
      requestKey: "legacy-source",
    });
    assert.equal(legacy.json().source_type, "PAYPAL");
    assert.equal(legacy.json().source_name, "PayPal");
  } finally {
    await s.app.close();
  }
});

test("payout reads expose only own operations to collaborators and enforce tenant and agreement access", async () => {
  const s = await setup();
  try {
    const get = (token: string, base = s.base) =>
      s.app.inject({
        method: "GET",
        url: `${base}/payouts`,
        headers: auth(token),
      });
    assert.equal((await get(s.other.token)).statusCode, 404);
    s.app.store.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(s.w.id, s.other.user.id, "MEMBER");
    assert.equal((await get(s.other.token)).statusCode, 403);
    const record = s.agg.read(s.w.id, "collab");
    record.value.members.push({
      userId: s.other.user.id,
      displayName: "Riley",
      role: MemberRole.COLLABORATOR,
    });
    s.app.store.db
      .prepare(
        "UPDATE fairshare_collaborations SET value=? WHERE workspace_id=? AND id=?",
      )
      .run(JSON.stringify(record.value), s.w.id, "collab");
    for (const [id, userId, amount] of [
      ["owner-payout", s.owner.user.id, 280000],
      ["riley-payout", s.other.user.id, 20000],
    ] as const)
      s.app.store.db
        .prepare(
          "INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_id,amount,status) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          s.w.id,
          "collab",
          "CAP1",
          userId,
          "private-recipient",
          amount,
          "SUCCESS",
        );
    const riley = await get(s.other.token);
    assert.equal(riley.statusCode, 200, riley.body);
    assert.deepEqual(
      riley.json().payouts.map((p: any) => p.id),
      ["riley-payout"],
    );
    assert.equal(riley.json().payouts[0].recipient_id, undefined);
    assert.equal((await get(s.owner.token)).json().payouts.length, 2);
    const otherTenant = s.app.store.createWorkspace(s.owner.user.id, "Private");
    assert.equal(
      (
        await get(
          s.other.token,
          `/api/workspaces/${otherTenant.id}/collaborations/collab`,
        )
      ).statusCode,
      404,
    );
  } finally {
    await s.app.close();
  }
});

test("disabled payout gates remain retryable without submitting or replaying money", async () => {
  const s = await setup();
  let providerRequests = 0;
  const config = {
    clientId: "synthetic",
    clientSecret: "synthetic",
    payoutsEnabled: false,
    payoutsEligibilityConfirmed: false,
  };
  const client = new PayPalSandbox(config, (async (url, init) => {
    providerRequests++;
    if (String(url).endsWith("/v1/oauth2/token"))
      return Response.json({ access_token: "synthetic", expires_in: 3600 });
    const body = JSON.parse(String(init?.body));
    return Response.json({
      batch_header: {
        payout_batch_id: "BATCH1",
        sender_batch_header: body.sender_batch_header,
      },
    });
  }) as typeof fetch);
  try {
    const payment = await s.post("/payments", {
      amountCents: 10000,
      requestKey: "one",
    });
    await s.post(`/payments/${payment.json().id}/capture`);
    await s.app.inject({
      method: "PUT",
      url: "/api/auth/payout-account",
      headers: auth(s.owner.token),
      payload: { email: " Owner.Pay@Example.test " },
    });
    s.provider.createPayout = client.createPayout.bind(client);
    await s.app.listen({ host: "127.0.0.1", port: 0 });
    const address = s.app.server.address();
    assert.ok(address && typeof address !== "string");
    const dispatch = () =>
      fetch(`http://127.0.0.1:${address.port}${s.base}/payouts/dispatch`, {
        method: "POST",
        headers: { ...auth(s.owner.token), "content-type": "application/json" },
        body: JSON.stringify({ captureId: "CAP1" }),
      });
    const disabled = await dispatch();
    assert.equal(disabled.status, 503, await disabled.text());
    assert.equal(providerRequests, 0);
    assert.equal(
      (
        s.app.store.db
          .prepare("SELECT status FROM fairshare_payout_ops")
          .get() as { status: string }
      ).status,
      "RESERVED",
    );
    config.payoutsEnabled = true;
    config.payoutsEligibilityConfirmed = true;
    const retried = await dispatch();
    assert.equal(retried.status, 200);
    assert.equal(((await retried.json()) as any).payouts[0].status, "PENDING");
    await dispatch();
    assert.equal(
      providerRequests,
      2,
      "one OAuth request and one payout submission",
    );
  } finally {
    await s.app.close();
  }
});

test("concurrent dispatch claims a recovered reservation once and never replays uncertain writes", async () => {
  const s = await setup();
  try {
    const payment = await s.post("/payments", {
      amountCents: 10000,
      requestKey: "one",
    });
    await s.post(`/payments/${payment.json().id}/capture`);
    const payoutId = "recovered-reservation";
    s.app.store.db
      .prepare(
        "INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_id,amount,status) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        payoutId,
        s.w.id,
        "collab",
        "CAP1",
        s.owner.user.id,
        "ABCDEFGHIJKLM",
        9700,
        "RESERVED",
      );
    let submissions = 0;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.provider.createPayout = async () => {
      submissions++;
      entered();
      await pending;
      throw new PayPalError("PAYPAL_OUTCOME_UNKNOWN");
    };
    const first = s.post("/payouts/dispatch", { captureId: "CAP1" });
    await started;
    const concurrent = await s.post("/payouts/dispatch", { captureId: "CAP1" });
    assert.equal(concurrent.json().payouts[0].status, "SUBMITTING");
    assert.equal(submissions, 1);
    release();
    assert.equal((await first).json().payouts[0].status, "OUTCOME_UNKNOWN");
    const retry = await s.post("/payouts/dispatch", { captureId: "CAP1" });
    assert.equal(retry.json().payouts[0].status, "OUTCOME_UNKNOWN");
    assert.equal(submissions, 1);
  } finally {
    await s.app.close();
  }
});
test("verified refund redelivery repairs only pending legacy mapping and stays idempotent", async () => {
  const s = await setup();
  try {
    const payment = (
      await s.post("/payments", {
        amountCents: 10000,
        requestKey: "refund-parent",
      })
    ).json();
    await s.post(`/payments/${payment.id}/capture`);
    const payload = {
      id: "refund-parent-event",
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: {
        id: "REF1",
        links: [
          {
            rel: "self",
            href: "https://api.sandbox.paypal.com/v2/payments/refunds/REF1",
            method: "GET",
          },
          {
            rel: "up",
            href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP1",
            method: "GET",
          },
        ],
      },
    };
    const { verifyAndPlanWebhook } = await import("@fairshare/payments");
    const plan = await verifyAndPlanWebhook(s.provider, {}, payload);
    const db = s.app.store.db;
    db.prepare("INSERT INTO fairshare_webhook_inbox VALUES(?,?,?,?,NULL)").run(
      payload.id,
      plan.fingerprint,
      JSON.stringify({
        kind: "HOLD_CAPTURE",
        eventId: payload.id,
        eventType: payload.event_type,
        providerId: "REF1",
        reason: payload.event_type,
      }),
      "PENDING",
    );
    const before = s.counts();
    for (let i = 0; i < 2; i++) {
      const result = await s.app.inject({
        method: "POST",
        url: "/api/paypal/webhook",
        payload,
      });
      assert.equal(result.statusCode, 200, result.body);
    }
    const row = db
      .prepare("SELECT * FROM fairshare_webhook_inbox WHERE id=?")
      .get(payload.id) as any;
    assert.equal(row.status, "DONE");
    assert.equal(JSON.parse(row.action).providerId, "CAP1");
    assert.equal(JSON.parse(row.action).refundId, "REF1");
    assert.equal(s.agg.read(s.w.id, "collab").value.revenue.length, 1);
    assert.deepEqual(
      s.counts(),
      before,
      "replay must never submit money writes",
    );
  } finally {
    await s.app.close();
  }
});
test("account-level email is sent as EMAIL; legacy workspace PayPal ID still pays; UNCLAIMED is not retried", async () => {
  for (const legacy of [false, true]) {
    const s = await setup();
    try {
      const id = (
        await s.post("/payments", { amountCents: 10000, requestKey: "one" })
      ).json().id;
      await s.post(`/payments/${id}/capture`);
      if (legacy)
        s.app.store.db
          .prepare("INSERT INTO fairshare_recipients VALUES(?,?,?)")
          .run(s.w.id, s.owner.user.id, "ABCDEFGHIJKLM");
      else
        await s.app.inject({
          method: "PUT",
          url: "/api/auth/payout-account",
          headers: auth(s.owner.token),
          payload: { email: "Owner.Pay@Example.test" },
        });
      const sent: any[] = [];
      s.provider.createPayout = async (input) => {
        sent.push(input);
        return { batchId: "BATCH1", status: "PENDING" as const };
      };
      s.provider.getPayout = async (batchId, expected) => {
        assert.equal(expected.recipientType, sent[0].recipientType);
        return { batchId, itemId: "ITEM1", status: "UNCLAIMED" };
      };
      const payout = (
        await s.post("/payouts/dispatch", { captureId: "CAP1" })
      ).json().payouts[0];
      assert.deepEqual(
        [sent[0].recipientType, sent[0].recipientId],
        legacy
          ? [RecipientType.PAYPAL_ID, "ABCDEFGHIJKLM"]
          : [RecipientType.EMAIL, "owner.pay@example.test"],
      );
      assert.equal(
        (await s.post(`/payouts/${payout.id}/reconcile`)).json().status,
        "UNCLAIMED",
      );
      await s.post("/payouts/dispatch", { captureId: "CAP1" });
      assert.equal(sent.length, 1);
    } finally {
      await s.app.close();
    }
  }
});

test("redelivery repairs an acknowledged ignored v2 decline once without money writes", async () => {
  const s = await setup();
  try {
    const payment = (
      await s.post("/payments", {
        amountCents: 10000,
        requestKey: "old-decline",
      })
    ).json();
    await s.post(`/payments/${payment.id}/capture`);
    const payload = {
      id: "old-decline",
      event_type: "PAYMENT.CAPTURE.DECLINED",
      resource: { id: "CAP1" },
    };
    const { verifyAndPlanWebhook } = await import("@fairshare/payments");
    const plan = await verifyAndPlanWebhook(s.provider, {}, payload);
    const db = s.app.store.db;
    db.prepare("INSERT INTO fairshare_webhook_inbox VALUES(?,?,?,?,NULL)").run(
      payload.id,
      plan.fingerprint,
      JSON.stringify({
        kind: "IGNORE",
        eventId: payload.id,
        eventType: payload.event_type,
      }),
      "DONE",
    );
    const before = s.counts();
    for (let i = 0; i < 2; i++) {
      const result = await s.app.inject({
        method: "POST",
        url: "/api/paypal/webhook",
        payload,
      });
      assert.equal(result.statusCode, 200, result.body);
      assert.equal(result.json().action, "HOLD_CAPTURE");
    }
    const row = db
      .prepare("SELECT * FROM fairshare_webhook_inbox WHERE id=?")
      .get(payload.id) as any;
    assert.equal(row.status, "DONE");
    assert.equal(JSON.parse(row.action).kind, "HOLD_CAPTURE");
    assert.ok(s.agg.read(s.w.id, "collab").value.reviewHold);
    assert.deepEqual(s.counts(), before);
    const altered = await s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: { ...payload, resource: { id: "OTHER" } },
    });
    assert.notEqual(altered.statusCode, 200);
    assert.equal(
      JSON.parse(
        (
          db
            .prepare("SELECT action FROM fairshare_webhook_inbox WHERE id=?")
            .get(payload.id) as any
        ).action,
      ).providerId,
      "CAP1",
    );
  } finally {
    await s.app.close();
  }
});

test("every unknown signed event returns 400 and keeps a durable pending receipt on retry", async () => {
  const s = await setup();
  try {
    for (const [event_type, expectedStatus, expectedAction] of [
      ["INVOICING.INVOICE.UNKNOWN", 400, "RECORD_UNMATCHED"],
      ["BILLING.SUBSCRIPTION.CREATED", 400, "RECORD_UNMATCHED"],
    ] as const) {
      const result = await s.app.inject({
        method: "POST",
        url: "/api/paypal/webhook",
        payload: { id: event_type, event_type },
      });
      assert.equal(result.statusCode, expectedStatus, result.body);
      assert.equal(result.json().action, expectedAction);
      assert.equal(result.json().accepted, false);
      assert.equal(result.json().error.code, "UNSUPPORTED_WEBHOOK_EVENT");
      const repeated = await s.app.inject({
        method: "POST",
        url: "/api/paypal/webhook",
        payload: { id: event_type, event_type },
      });
      assert.equal(repeated.statusCode, 400);
      const receipt = s.app.store.db
        .prepare("SELECT status,error FROM fairshare_webhook_inbox WHERE id=?")
        .get(event_type) as any;
      assert.equal(receipt.status, "PENDING");
      assert.equal(receipt.error, "UNSUPPORTED_WEBHOOK_EVENT");
    }
    assert.deepEqual(s.counts(), { writes: 0, captures: 0, payoutWrites: 0 });
  } finally {
    await s.app.close();
  }
});

test("checkout approval triggers a read only, and reversal before capture blocks the write", async () => {
  const s = await setup();
  try {
    const payment = (
      await s.post("/payments", {
        amountCents: 10000,
        requestKey: "approval-events",
      })
    ).json();
    let reads = 0;
    s.provider.getOrder = async () => {
      reads++;
      return { status: "APPROVED" };
    };
    const approval = await s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: {
        id: "approval",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: "ORDER1" },
      },
    });
    assert.equal(approval.statusCode, 200, approval.body);
    assert.equal(reads, 1);
    assert.equal(s.counts().captures, 0);
    const reversal = await s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: {
        id: "approval-reversed",
        event_type: "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
        resource: { order_id: "ORDER1" },
      },
    });
    assert.equal(reversal.statusCode, 503);
    const capture = await s.post(`/payments/${payment.id}/capture`);
    assert.equal(capture.json().error.code, "PAYMENT_HOLD");
    assert.equal(s.counts().captures, 0);
  } finally {
    await s.app.close();
  }
});

test("payout batch events read matching recipient results rather than trusting batch success", async () => {
  const s = await setup();
  try {
    const payment = (
      await s.post("/payments", {
        amountCents: 10000,
        requestKey: "batch-events",
      })
    ).json();
    await s.post(`/payments/${payment.id}/capture`);
    const db = s.app.store.db;
    db.prepare(
      "INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_id,amount,batch_id,status) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      "payout-1",
      s.w.id,
      "collab",
      "CAP1",
      s.owner.user.id,
      "MERCHANT1",
      9700,
      "BATCH1",
      "PENDING",
    );
    let reads = 0;
    s.provider.getPayout = async () => {
      reads++;
      return { batchId: "BATCH1", itemId: "ITEM1", status: "UNCLAIMED" };
    };
    const result = await s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: {
        id: "batch-success",
        event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS",
        resource: { batch_header: { payout_batch_id: "BATCH1" } },
      },
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(reads, 1);
    assert.equal(
      (
        db
          .prepare(
            "SELECT status FROM fairshare_payout_ops WHERE id='payout-1'",
          )
          .get() as any
      ).status,
      "UNCLAIMED",
    );
    assert.equal(s.counts().payoutWrites, 0);
  } finally {
    await s.app.close();
  }
});

test("refund status notifications reconcile exact reserved refunds and keep terminal conflicts pending", async () => {
  const s = await setup();
  try {
    const db = s.app.store.db;
    db.prepare(
      "INSERT INTO fairshare_refund_ops VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "refund-op",
      s.w.id,
      "collab",
      "payment",
      "CAP1",
      10000,
      "refund-key",
      "REF1",
      "PENDING",
      s.owner.user.id,
      new Date().toISOString(),
    );
    s.provider.getRefund = async () => ({
      id: "REF1",
      amountCents: 10000,
      currency: "USD",
      captureId: "CAP1",
      reference: "refund-key",
      status: "FAILED",
    });
    const result = await s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: {
        id: "refund-failed",
        event_type: "PAYMENT.REFUND.FAILED",
        resource: { id: "REF1" },
      },
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(
      (
        db
          .prepare(
            "SELECT status FROM fairshare_refund_ops WHERE id='refund-op'",
          )
          .get() as any
      ).status,
      "FAILED",
    );
    s.provider.getRefund = async () => ({
      id: "REF1",
      amountCents: 10000,
      currency: "USD",
      captureId: "CAP1",
      reference: "refund-key",
      status: "PENDING",
    });
    const late = await s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: {
        id: "refund-late",
        event_type: "PAYMENT.REFUND.PENDING",
        resource: { id: "REF1" },
      },
    });
    assert.equal(late.statusCode, 503);
    assert.equal(
      (
        db
          .prepare(
            "SELECT error FROM fairshare_webhook_inbox WHERE id='refund-late'",
          )
          .get() as any
      ).error,
      "REFUND_STATUS_CONFLICT",
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT status FROM fairshare_refund_ops WHERE id='refund-op'",
          )
          .get() as any
      ).status,
      "FAILED",
    );
  } finally {
    await s.app.close();
  }
});

test("a multi-transaction dispute holds a known later transaction and retains unmatched evidence", async () => {
  const s = await setup();
  try {
    const payment = (
      await s.post("/payments", {
        amountCents: 10000,
        requestKey: "multi-dispute",
      })
    ).json();
    await s.post(`/payments/${payment.id}/capture`);
    const result = await s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: {
        id: "multiple-dispute",
        event_type: "CUSTOMER.DISPUTE.UPDATED",
        resource: {
          disputed_transactions: [
            { seller_transaction_id: "UNKNOWN" },
            { seller_transaction_id: "CAP1" },
          ],
        },
      },
    });
    assert.equal(result.statusCode, 503);
    assert.ok(s.agg.read(s.w.id, "collab").value.reviewHold);
  } finally {
    await s.app.close();
  }
});

test("previously unsupported events can be accepted after an exact signed redelivery adds support", async () => {
  const s = await setup();
  try {
    await s.post("/payments", {
      amountCents: 10000,
      requestKey: "new-support",
    });
    let reads = 0;
    s.provider.getOrder = async () => {
      reads++;
      return { status: "APPROVED" };
    };
    const payload = {
      id: "added-support",
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: { id: "ORDER1" },
    };
    const { verifyAndPlanWebhook } = await import("@fairshare/payments");
    const planned = await verifyAndPlanWebhook(s.provider, {}, payload);
    const db = s.app.store.db;
    db.prepare("INSERT INTO fairshare_webhook_inbox VALUES(?,?,?,?,?)").run(
      payload.id,
      planned.fingerprint,
      JSON.stringify({
        kind: "RECORD_UNMATCHED",
        eventId: payload.id,
        eventType: payload.event_type,
        reason: "UNSUPPORTED_WEBHOOK_EVENT",
      }),
      "PENDING",
      "UNSUPPORTED_WEBHOOK_EVENT",
    );
    for (let i = 0; i < 2; i++) {
      const result = await s.app.inject({
        method: "POST",
        url: "/api/paypal/webhook",
        payload,
      });
      assert.equal(result.statusCode, 200, result.body);
      assert.equal(result.json().action, "RECONCILE_ORDER");
    }
    assert.equal(reads, 1);
    assert.equal(s.counts().captures, 0);
    s.badSignature();
    const invalid = await s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: { id: "unsigned-unknown", event_type: "NEW.UNKNOWN" },
    });
    assert.equal(invalid.statusCode, 401);
    assert.equal(
      db
        .prepare(
          "SELECT id FROM fairshare_webhook_inbox WHERE id='unsigned-unknown'",
        )
        .get(),
      undefined,
    );
  } finally {
    await s.app.close();
  }
});

test("legacy sale refund holds its recorded settlement and never guesses the refund ID", async () => {
  const s = await setup();
  try {
    const payment = (
      await s.post("/payments", {
        amountCents: 10000,
        requestKey: "sale-refund",
      })
    ).json();
    await s.post(`/payments/${payment.id}/capture`);
    const result = await s.app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: {
        id: "sale-refund",
        event_type: "PAYMENT.SALE.REFUNDED",
        resource: { id: "REF1", sale_id: "CAP1" },
      },
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.ok(s.agg.read(s.w.id, "collab").value.reviewHold);
  } finally {
    await s.app.close();
  }
});
