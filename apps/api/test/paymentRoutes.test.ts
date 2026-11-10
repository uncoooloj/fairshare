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
import { PayPalError, PayPalSandbox } from "@fairshare/payments";
import type { PaymentProvider } from "../src/paymentRoutes.js";
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
async function setup() {
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
    payment: { provider, publicOrigin: "https://callbacks.example.test" },
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
      url: s.base + "/recipient",
      headers: auth(s.owner.token),
      payload: { paypalId: "ABCDEFGHIJKLM" },
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
