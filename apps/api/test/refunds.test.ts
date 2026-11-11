import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../src/app.js";
import { AggregateStore } from "../src/fairshare.js";
import type { PaymentProvider } from "../src/paymentRoutes.js";
import {
  createCollaboration,
  proposeVersion,
  sendForReview,
  approveVersion,
  activateVersion,
  MemberRole,
  RuleOrigin,
  FeePolicy,
  holdReversedRevenue,
} from "@fairshare/domain";

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const fee = (cents: number) => Math.round(cents * 0.03);

/** Mocked PayPal only. Orders and refunds are numbered; each capture's fee is 3%. */
function mockProvider() {
  const orders = new Map<string, { reference: string; amountCents: number }>();
  const refunds = new Map<string, any>();
  const counts = { refundWrites: 0, payoutWrites: 0 };
  const config = {
    /** Fee PayPal gives back with a refund, as a function of the refund amount. */
    feeReturned: (_cents: number) => 0,
    payoutGate: null as Promise<void> | null,
    /** Status PayPal gives new refunds and reports for payouts. */
    refundStatus: "COMPLETED",
    payoutStatus: "PENDING",
  };
  const capture = (orderId: string) => {
    const order = orders.get(orderId)!;
    return {
      id: orderId.replace("ORDER", "CAP"),
      orderId,
      reference: order.reference,
      amountCents: order.amountCents,
      currency: "USD",
      status: "COMPLETED",
      accounting: {
        feeCents: fee(order.amountCents),
        netCents: order.amountCents - fee(order.amountCents),
      },
    };
  };
  const provider: PaymentProvider = {
    createOrder: async (input) => {
      const id = `ORDER${orders.size + 1}`;
      orders.set(id, {
        reference: input.reference,
        amountCents: input.amountCents,
      });
      return { id, approvalUrl: "https://www.sandbox.paypal.com/approve" };
    },
    captureOrder: async (orderId) => capture(orderId),
    getOrder: async (orderId) => ({
      status: "COMPLETED",
      capture: capture(orderId),
    }),
    createPayout: async () => {
      counts.payoutWrites++;
      if (config.payoutGate) await config.payoutGate;
      return { batchId: `BATCH${counts.payoutWrites}`, status: "PENDING" };
    },
    getPayout: async (batchId) => ({
      batchId,
      itemId: "ITEM",
      status: config.payoutStatus,
    }),
    verifyWebhook: async () => true,
    refundCapture: async (captureId, amountCents, currency, key) => {
      counts.refundWrites++;
      const refund = external(captureId, amountCents, key);
      return { ...refund };
    },
    getRefund: async (id) => ({ ...refunds.get(id) }),
  };
  /** A refund PayPal knows about, as if made in PayPal or by refundCapture. */
  function external(captureId: string, amountCents: number, reference = "") {
    const id = `REF${refunds.size + 1}`;
    const returned = config.feeReturned(amountCents);
    refunds.set(id, {
      id,
      status: config.refundStatus,
      amountCents,
      currency: "USD",
      captureId,
      reference,
      accounting: {
        grossCents: amountCents,
        feeReturnedCents: returned,
        netCents: amountCents - returned,
      },
    });
    return refunds.get(id);
  }
  return { provider, counts, config, external, refunds };
}

/** Maya organizes, Riley collaborates; 60/40 of the money after PayPal's fee. */
async function setup(dbPath = ":memory:") {
  const mock = mockProvider();
  const app = await buildApp({
    dbPath,
    payment: {
      provider: mock.provider,
      publicOrigin: "https://callbacks.example.test",
    },
  });
  const maya = app.store.register({
    name: "Maya",
    email: "maya@example.test",
    password: "Correct-Horse-123",
  });
  const riley = app.store.register({
    name: "Riley",
    email: "riley@example.test",
    password: "Correct-Horse-123",
  });
  const w = app.store.createWorkspace(maya.user.id, "Test");
  app.store.db
    .prepare("INSERT INTO memberships VALUES(?,?,?)")
    .run(w.id, riley.user.id, "MEMBER");
  const agg = new AggregateStore(app.store.db, (f) => app.store.tx(f));
  const at = () => new Date().toISOString();
  let c = createCollaboration(
    {
      id: "collab",
      name: "Test",
      members: [
        {
          userId: maya.user.id,
          displayName: "Maya",
          role: MemberRole.ORGANIZER,
        },
        {
          userId: riley.user.id,
          displayName: "Riley",
          role: MemberRole.COLLABORATOR,
        },
      ],
    },
    maya.user.id,
    at(),
  );
  c = proposeVersion(
    c,
    {
      currency: "USD",
      feePolicy: FeePolicy.BEFORE_SPLIT,
      shares: [
        { userId: maya.user.id, basisPoints: 6000 },
        { userId: riley.user.id, basisPoints: 4000 },
      ],
      source: {
        origin: RuleOrigin.HUMAN_PROPOSAL,
        documentId: "doc",
        clause: "1",
        excerpt: "60/40",
      },
      unresolvedQuestions: [],
    },
    maya.user.id,
    at(),
  );
  c = sendForReview(c, 1, maya.user.id, at());
  c = approveVersion(c, 1, maya.user.id, at());
  c = approveVersion(c, 1, riley.user.id, at());
  c = activateVersion(c, 1, maya.user.id, at());
  agg.insert(w.id, c);
  const base = `/api/workspaces/${w.id}/collaborations/collab`;
  const post = (suffix: string, payload: any = {}, token = maya.token) =>
    app.inject({
      method: "POST",
      url: base + suffix,
      headers: auth(token),
      payload,
    });
  let payments = 0;
  /** Takes a payment; returns its Fairshare payment ID and PayPal capture ID. */
  const pay = async (amountCents = 10000) => {
    const id = (
      await post("/payments", {
        amountCents,
        requestKey: `pay-${++payments}`,
      })
    ).json().id;
    const r = await post(`/payments/${id}/capture`);
    assert.equal(r.json().confirmed, true, r.body);
    return { id, captureId: r.json().payment.provider_capture_id as string };
  };
  const setEmails = async () => {
    for (const [token, email] of [
      [maya.token, "maya.pay@example.test"],
      [riley.token, "riley.pay@example.test"],
    ])
      await app.inject({
        method: "PUT",
        url: "/api/auth/payout-account",
        headers: auth(token),
        payload: { email },
      });
  };
  const agreement = () => agg.read(w.id, "collab");
  const totals = (captureId: string) =>
    Object.fromEntries(
      agreement()
        .value.revenue.find((r) => r.providerCaptureId === captureId)!
        .allocations.map((a) => [
          a.userId === maya.user.id ? "maya" : "riley",
          a.totalCents,
        ]),
    );
  const owed = () =>
    Object.fromEntries(
      Object.entries(agreement().value.owedBack ?? {}).map(([id, cents]) => [
        id === maya.user.id ? "maya" : "riley",
        cents,
      ]),
    );
  const ops = (captureId: string) =>
    Object.fromEntries(
      (
        app.store.db
          .prepare(
            "SELECT user_id,status,amount FROM fairshare_payout_ops WHERE capture_id=?",
          )
          .all(captureId) as any[]
      ).map((r) => [
        r.user_id === maya.user.id ? "maya" : "riley",
        [r.status, r.amount],
      ]),
    );
  const webhook = (id: string, type: string, resource: any) =>
    app.inject({
      method: "POST",
      url: "/api/paypal/webhook",
      payload: { id, event_type: type, resource },
    });
  /** PayPal reporting a refund on a capture (verified parent link). */
  const refundEvent = (eventId: string, refundId: string, captureId: string) =>
    webhook(eventId, "PAYMENT.CAPTURE.REFUNDED", {
      id: refundId,
      links: [
        {
          rel: "up",
          method: "GET",
          href: `https://api.sandbox.paypal.com/v2/payments/captures/${captureId}`,
        },
      ],
    });
  const recovery = async () =>
    (
      await app.inject({
        url: base + "/recovery",
        headers: auth(maya.token),
      })
    ).json();
  const resume = (payload: any = {}, token = maya.token) =>
    post(
      "/payments/resume",
      { expectedRevision: agreement().revision, ...payload },
      token,
    );
  return {
    app,
    mock,
    maya,
    riley,
    w,
    agg,
    base,
    post,
    pay,
    setEmails,
    agreement,
    totals,
    owed,
    ops,
    webhook,
    refundEvent,
    recovery,
    resume,
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;
async function run(body: (s: Setup) => Promise<void>) {
  const s = await setup();
  try {
    await body(s);
  } finally {
    await s.app.close();
  }
}

test("partial refund before payouts comes out of the split, waiting payouts follow, nothing pauses", () =>
  run(async (s) => {
    s.mock.config.feeReturned = (cents) => fee(cents); // PayPal gives its fee back
    const { id, captureId } = await s.pay();
    assert.deepEqual(s.totals(captureId), { maya: 5820, riley: 3880 });
    // Nobody has a payout email yet: rows wait, nothing is sent.
    await s.post("/payouts/dispatch", { captureId });
    assert.deepEqual(s.ops(captureId), {
      maya: ["WAITING_RECIPIENT", 5820],
      riley: ["WAITING_RECIPIENT", 3880],
    });
    const r = await s.post(`/payments/${id}/refund`, {
      confirmRefund: true,
      amountCents: 5000,
      requestKey: "partial-1",
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().status, "COMPLETED");
    assert.equal(r.json().outcome, "REVERSED_BY_SPLIT");
    assert.equal(r.json().holdRemains, false);
    // 5000 refunded, 150 fee returned: 4850 off the 9700, 60/40.
    assert.deepEqual(s.totals(captureId), { maya: 2910, riley: 1940 });
    assert.equal(s.agreement().value.reviewHold, false);
    assert.deepEqual(s.ops(captureId), {
      maya: ["WAITING_RECIPIENT", 2910],
      riley: ["WAITING_RECIPIENT", 1940],
    });
    await s.setEmails();
    const sent = await s.post("/payouts/dispatch", { captureId });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.deepEqual(s.ops(captureId), {
      maya: ["PENDING", 2910],
      riley: ["PENDING", 1940],
    });
  }));

test("multiple partial refunds cannot exceed the payment; retries never refund twice", () =>
  run(async (s) => {
    const { id, captureId } = await s.pay();
    const refund = (amountCents: number, requestKey: string) =>
      s.post(`/payments/${id}/refund`, {
        confirmRefund: true,
        amountCents,
        requestKey,
      });
    assert.equal((await refund(3000, "a")).json().outcome, "REVERSED_BY_SPLIT");
    assert.equal((await refund(3000, "a")).json().amountCents, 3000);
    assert.equal(s.mock.counts.refundWrites, 1);
    assert.equal(
      (await refund(2000, "a")).json().error.code,
      "IDEMPOTENCY_CONFLICT",
    );
    assert.equal((await refund(3000, "b")).statusCode, 200);
    // 6000 refunded so far: 4000 left.
    const over = await refund(4001, "c");
    assert.equal(over.statusCode, 400);
    assert.equal(over.json().error.code, "REFUND_EXCEEDS_PAYMENT");
    assert.equal(
      (
        await s.post(`/payments/${id}/refund`, {
          confirmRefund: true,
          amountCents: 1000,
        })
      ).json().error.code,
      "INVALID_INPUT",
    );
    // The full-refund shortcut refunds what is left.
    const rest = await s.post(`/payments/${id}/refund`, {
      confirmFullRefund: true,
    });
    assert.equal(rest.json().amountCents, 4000);
    assert.equal(s.mock.counts.refundWrites, 3);
    assert.deepEqual(s.totals(captureId), { maya: 0, riley: 0 });
    // PayPal kept its 300 fee: shared 60/40 as owed, and payouts pause for review.
    assert.equal(rest.json().outcome, "PAUSED_FOR_REVIEW");
    assert.deepEqual(s.owed(), { maya: 180, riley: 120 });
    assert.equal(
      (
        await s.post(`/payments/${id}/refund`, {
          confirmRefund: true,
          amountCents: 1,
          requestKey: "d",
        })
      ).statusCode,
      400,
    );
  }));

test("provider refund replays never reverse twice, including one Fairshare started", () =>
  run(async (s) => {
    const { id, captureId } = await s.pay();
    const paypal = s.mock.external(captureId, 2000);
    assert.equal(
      (await s.refundEvent("evt-1", paypal.id, captureId)).statusCode,
      200,
    );
    const once = s.agreement();
    assert.deepEqual(s.totals(captureId), { maya: 4620, riley: 3080 });
    assert.equal(once.value.reviewHold, false);
    // Same event again, and the same refund in a different event.
    assert.equal(
      (await s.refundEvent("evt-1", paypal.id, captureId)).statusCode,
      200,
    );
    assert.equal(
      (await s.refundEvent("evt-2", paypal.id, captureId)).statusCode,
      200,
    );
    assert.equal(s.agreement().revision, once.revision);
    // A refund made here, then reported by PayPal too.
    const mine = await s.post(`/payments/${id}/refund`, {
      confirmRefund: true,
      amountCents: 1000,
      requestKey: "mine",
    });
    assert.equal(mine.json().outcome, "REVERSED_BY_SPLIT");
    const after = s.agreement();
    assert.equal(
      (
        await s.refundEvent(
          "evt-3",
          mine.json().providerRefundId as string,
          captureId,
        )
      ).statusCode,
      200,
    );
    assert.equal(s.agreement().revision, after.revision);
    assert.deepEqual(s.totals(captureId), { maya: 4020, riley: 2680 });
    // The external refund counts against what is left to refund here.
    assert.equal(
      (
        await s.post(`/payments/${id}/refund`, {
          confirmRefund: true,
          amountCents: 7001,
          requestKey: "too-much",
        })
      ).json().error.code,
      "REFUND_EXCEEDS_PAYMENT",
    );
  }));

test("a partial refund using the implicit full key cannot impersonate a full-refund retry", () =>
  run(async (s) => {
    const { id } = await s.pay();
    s.mock.config.refundStatus = "PENDING";
    const partial = await s.post(`/payments/${id}/refund`, {
      confirmRefund: true,
      amountCents: 3000,
      requestKey: "full",
    });
    assert.equal(partial.statusCode, 200, partial.body);
    const full = await s.post(`/payments/${id}/refund`, {
      confirmFullRefund: true,
    });
    assert.equal(full.statusCode, 400, full.body);
    assert.equal(full.json().error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(s.mock.counts.refundWrites, 1);
  }));

test("provider webhook settlement during submission is not regressed by the submitting request", () =>
  run(async (s) => {
    const { id, captureId } = await s.pay();
    let requestKey = "";
    s.mock.provider.getRefund = async (refundId) => ({
      id: refundId,
      status: "COMPLETED",
      amountCents: 10000,
      currency: "USD",
      captureId,
      reference: requestKey,
    });
    s.mock.provider.refundCapture = async (
      _capture,
      amountCents,
      currency,
      key,
    ) => {
      requestKey = key;
      const settled = await s.refundEvent(
        "refund-during-submit",
        "REF1",
        captureId,
      );
      assert.equal(settled.statusCode, 200, settled.body);
      return { id: "REF1", status: "COMPLETED", amountCents, currency };
    };
    const response = await s.post(`/payments/${id}/refund`, {
      confirmFullRefund: true,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().status, "COMPLETED");
    assert.equal(
      (
        s.app.store.db
          .prepare("SELECT status FROM fairshare_refund_ops")
          .get() as any
      ).status,
      "COMPLETED",
    );
  }));

test("provider webhook failure during submission survives the submitter catch", () =>
  run(async (s) => {
    const { id, captureId } = await s.pay();
    let requestKey = "";
    s.mock.provider.getRefund = async (refundId) => ({
      id: refundId,
      status: "FAILED",
      amountCents: 10000,
      currency: "USD",
      captureId,
      reference: requestKey,
    });
    s.mock.provider.refundCapture = async (
      _capture,
      _amountCents,
      _currency,
      key,
    ) => {
      requestKey = key;
      // The provider has assigned REF1 and delivers its terminal webhook before the request
      // response reaches Fairshare. The webhook path itself then verifies the refund by inject.
      s.app.store.db
        .prepare(
          "UPDATE fairshare_refund_ops SET provider_refund_id=? WHERE request_key=?",
        )
        .run("REF1", key);
      const settled = await s.webhook(
        "refund-failed-during-submit",
        "PAYMENT.REFUND.FAILED",
        { id: "REF1" },
      );
      assert.equal(settled.statusCode, 200, settled.body);
      throw new Error("provider transport closed after webhook delivery");
    };
    const response = await s.post(`/payments/${id}/refund`, {
      confirmFullRefund: true,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().status, "FAILED");
    assert.equal(
      (
        s.app.store.db
          .prepare("SELECT status FROM fairshare_refund_ops")
          .get() as any
      ).status,
      "FAILED",
    );
  }));

test("a provider refund racing a payout dispatch: shares in flight count as paid out, the rest stop", () =>
  run(async (s) => {
    const { captureId } = await s.pay();
    await s.setEmails();
    let release!: () => void, started!: () => void;
    const began = new Promise<void>((r) => (started = r));
    s.mock.config.payoutGate = new Promise<void>((r) => (release = r)).then(
      () => undefined,
    );
    const original = s.mock.provider.createPayout;
    s.mock.provider.createPayout = async (input) => {
      started();
      return original(input);
    };
    const dispatch = s.post("/payouts/dispatch", { captureId });
    await began;
    // Maya's share is SUBMITTING (may reach PayPal), Riley's is RESERVED.
    const paypal = s.mock.external(captureId, 5000);
    assert.equal(
      (await s.refundEvent("race", paypal.id, captureId)).statusCode,
      200,
    );
    release();
    assert.equal((await dispatch).statusCode, 200);
    assert.equal(s.mock.counts.payoutWrites, 1);
    assert.equal(s.agreement().value.reviewHold, true);
    // 5000 off 9700: Maya 3000, Riley 2000. Maya was (maybe) paid 5820, Riley nothing.
    assert.deepEqual(s.totals(captureId), { maya: 2820, riley: 1880 });
    assert.deepEqual(s.owed(), { maya: 3000 });
    const ops = s.ops(captureId);
    assert.equal(ops.maya[0], "PENDING");
    assert.deepEqual(ops.riley, ["HELD", 3880]);
    // After review, Riley's stopped share goes back to waiting at the new amount.
    assert.equal((await s.resume()).statusCode, 200);
    assert.deepEqual(s.ops(captureId).riley, ["AUTO_HELD", 1880]);
    await s.post("/payouts/dispatch", { captureId });
    assert.deepEqual(s.ops(captureId).riley, ["PENDING", 1880]);
    assert.equal(s.mock.counts.payoutWrites, 2);
  }));

test("refund after payouts pauses, shows each person's overpayment, and resume puts held shares back", () =>
  run(async (s) => {
    const { captureId } = await s.pay();
    const second = await s.pay();
    await s.setEmails();
    await s.post("/payouts/dispatch", { captureId });
    const paypal = s.mock.external(captureId, 5000);
    await s.refundEvent("after", paypal.id, captureId);
    assert.equal(s.agreement().value.reviewHold, true);
    assert.deepEqual(s.owed(), { maya: 3000, riley: 2000 });
    const review = (await s.recovery()).review;
    assert.equal(review.paused, true);
    assert.deepEqual(
      review.owed.map((o: any) => [o.name, o.cents]),
      [
        ["Maya", 3000],
        ["Riley", 2000],
      ],
    );
    assert.deepEqual(review.blockers, []);
    // The other payment is paused too, and a dispatch leaves its rows HELD.
    const blocked = await s.post("/payouts/dispatch", {
      captureId: second.captureId,
    });
    assert.equal(blocked.statusCode, 400);
    // Collaborators cannot resume; a stale revision is refused.
    assert.equal((await s.resume({}, s.riley.token)).statusCode, 403);
    assert.equal(
      (
        await s.post("/payments/resume", {
          expectedRevision: s.agreement().revision - 1,
        })
      ).json().error.code,
      "REVISION_CONFLICT",
    );
    const resumed = await s.resume({ note: "Paid back by bank transfer" });
    assert.equal(resumed.statusCode, 200, resumed.body);
    assert.equal(resumed.json().value.reviewHold, false);
    assert.equal(resumed.json().value.owedBack, undefined);
    assert.equal((await s.resume()).json().error.code, "NOT_PAUSED");
    assert.ok(
      (await s.recovery()).audit.some((e: any) => e.kind === "PAYOUTS_RESUMED"),
    );
    assert.equal(
      s.agreement().value.audit.at(-1)!.details.note,
      "Paid back by bank transfer",
    );
    const sent = await s.post("/payouts/dispatch", {
      captureId: second.captureId,
    });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.deepEqual(s.ops(second.captureId), {
      maya: ["PENDING", 5820],
      riley: ["PENDING", 3880],
    });
  }));

test("resume is refused while a dispute is open, a PayPal update is unchecked or a refund is unsettled", () =>
  run(async (s) => {
    const { id, captureId } = await s.pay();
    const dispute = (eventId: string, type: string) =>
      s.webhook(eventId, type, {
        dispute_id: "PP-D-1",
        disputed_transactions: [{ seller_transaction_id: captureId }],
      });
    assert.equal(
      (await dispute("d1", "CUSTOMER.DISPUTE.CREATED")).statusCode,
      200,
    );
    assert.equal(s.agreement().value.reviewHold, true);
    let refused = await s.resume();
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error.code, "DISPUTE_OPEN");
    assert.deepEqual((await s.recovery()).review.blockers, ["DISPUTE_OPEN"]);
    await dispute("d2", "CUSTOMER.DISPUTE.RESOLVED");
    // An update that arrives late never reopens a closed dispute.
    await dispute("d3", "CUSTOMER.DISPUTE.UPDATED");
    // An unchecked PayPal update about this agreement.
    s.app.store.db
      .prepare(
        "INSERT INTO fairshare_webhook_inbox VALUES('stuck','fp',?,'PENDING','UNMATCHED_EVENT')",
      )
      .run(
        JSON.stringify({
          kind: "HOLD_CAPTURE",
          providerId: captureId,
          eventType: "PAYMENT.CAPTURE.REVERSED",
        }),
      );
    refused = await s.resume();
    assert.equal(refused.json().error.code, "WEBHOOK_UNRECONCILED");
    s.app.store.db
      .prepare(
        "UPDATE fairshare_webhook_inbox SET status='DONE' WHERE id='stuck'",
      )
      .run();
    // A refund still going through.
    s.app.store.db
      .prepare(
        "INSERT INTO fairshare_refund_ops(id,workspace_id,collaboration_id,payment_id,capture_id,amount,request_key,status,created_by,created_at,client_key) VALUES('r',?,'collab',?,?,100,'rk','OUTCOME_UNKNOWN','x','now','k')",
      )
      .run(s.w.id, id, captureId);
    refused = await s.resume();
    assert.equal(refused.json().error.code, "REFUND_UNRECONCILED");
    s.app.store.db
      .prepare("UPDATE fairshare_refund_ops SET status='FAILED' WHERE id='r'")
      .run();
    const ok = await s.resume();
    assert.equal(ok.statusCode, 200, ok.body);
  }));

test("offset: overpayments come off each person's next shares until settled", () =>
  run(async (s) => {
    const { captureId } = await s.pay();
    await s.setEmails();
    await s.post("/payouts/dispatch", { captureId });
    const paypal = s.mock.external(captureId, 5000);
    await s.refundEvent("after", paypal.id, captureId);
    assert.deepEqual(s.owed(), { maya: 3000, riley: 2000 });
    assert.equal(
      (await s.resume({ offsetFromFuturePayouts: "yes" })).statusCode,
      400,
    );
    const resumed = await s.resume({ offsetFromFuturePayouts: true });
    assert.equal(resumed.statusCode, 200, resumed.body);
    assert.equal(resumed.json().value.offsetOwedBack, true);
    // 4000 payment, 120 fee: 3880 net, 2328/1552 all kept back.
    const small = await s.pay(4000);
    assert.deepEqual(s.totals(small.captureId), { maya: 0, riley: 0 });
    assert.deepEqual(s.owed(), { maya: 672, riley: 448 });
    const big = await s.pay(10000);
    assert.deepEqual(s.totals(big.captureId), {
      maya: 5820 - 672,
      riley: 3880 - 448,
    });
    assert.deepEqual(s.owed(), {});
    assert.equal(s.agreement().value.offsetOwedBack, undefined);
    const sent = await s.post("/payouts/dispatch", {
      captureId: big.captureId,
    });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.deepEqual(s.ops(big.captureId), {
      maya: ["PENDING", 5148],
      riley: ["PENDING", 3432],
    });
    const third = await s.pay(10000);
    assert.deepEqual(s.totals(third.captureId), { maya: 5820, riley: 3880 });
  }));

test("a PayPal reversal takes the whole payment out of the split and pauses", () =>
  run(async (s) => {
    const { captureId } = await s.pay();
    const r = await s.webhook("rev", "PAYMENT.CAPTURE.REVERSED", {
      id: captureId,
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(s.totals(captureId), { maya: 0, riley: 0 });
    assert.equal(s.agreement().value.reviewHold, true);
    // PayPal's 300 fee is not returned on a reversal: shared 60/40.
    assert.deepEqual(s.owed(), { maya: 180, riley: 120 });
  }));

const reversalEvent = (
  s: Setup,
  eventId: string,
  captureId: string,
  cents: number,
) =>
  s.webhook(eventId, "PAYMENT.CAPTURE.REVERSED", {
    id: captureId,
    amount: { currency_code: "USD", value: (cents / 100).toFixed(2) },
  });

test("a reversal leaves room for a refund still going through; when it completes both reconcile", () =>
  run(async (s) => {
    const { id, captureId } = await s.pay();
    s.mock.config.refundStatus = "PENDING";
    const pending = await s.post(`/payments/${id}/refund`, {
      confirmRefund: true,
      amountCents: 3000,
      requestKey: "in-flight",
    });
    assert.equal(pending.json().outcome, "WAITING_FOR_PAYPAL");
    assert.equal(
      (await reversalEvent(s, "rev", captureId, 10000)).statusCode,
      200,
    );
    const revenue = () =>
      s
        .agreement()
        .value.revenue.find((r) => r.providerCaptureId === captureId)!;
    assert.deepEqual(
      revenue().refunds!.map((r) => [r.kind, r.grossCents]),
      [["REVERSAL", 7000]],
    );
    // PayPal completes the refund: it takes the last 3000, nothing is stuck.
    s.mock.refunds.get(pending.json().providerRefundId)!.status = "COMPLETED";
    const done = await s.post(`/refunds/${pending.json().id}/reconcile`);
    assert.equal(done.statusCode, 200, done.body);
    assert.deepEqual(s.totals(captureId), { maya: 0, riley: 0 });
    assert.equal(
      revenue().refunds!.reduce((sum, r) => sum + r.grossCents, 0),
      10000,
    );
    assert.deepEqual((await s.recovery()).review.blockers, []);
    assert.equal((await s.resume()).statusCode, 200);
  }));

test("a refund that completes before a reversal is left out of the reversal", () =>
  run(async (s) => {
    const { id, captureId } = await s.pay();
    await s.post(`/payments/${id}/refund`, {
      confirmRefund: true,
      amountCents: 3000,
      requestKey: "first",
    });
    await reversalEvent(s, "rev", captureId, 10000);
    const refunds = s
      .agreement()
      .value.revenue.find((r) => r.providerCaptureId === captureId)!.refunds!;
    assert.deepEqual(
      refunds.map((r) => [r.kind, r.grossCents]),
      [
        ["REFUND", 3000],
        ["REVERSAL", 7000],
      ],
    );
    assert.deepEqual(s.totals(captureId), { maya: 0, riley: 0 });
  }));

test("a refund PayPal reports after a full reversal is settled by it, not stuck", () =>
  run(async (s) => {
    const { captureId } = await s.pay();
    await reversalEvent(s, "rev", captureId, 10000);
    const before = s.agreement().revision;
    const late = s.mock.external(captureId, 3000);
    const r = await s.refundEvent("late", late.id, captureId);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(s.agreement().revision, before);
    assert.deepEqual((await s.recovery()).review.blockers, []);
    assert.equal((await s.resume()).statusCode, 200);
  }));

test("a payout PayPal returns releases the overpayment it was counted for", () =>
  run(async (s) => {
    const { captureId } = await s.pay();
    await s.setEmails();
    const sent = await s.post("/payouts/dispatch", { captureId });
    const paypal = s.mock.external(captureId, 5000);
    await s.refundEvent("after", paypal.id, captureId);
    assert.deepEqual(s.owed(), { maya: 3000, riley: 2000 });
    s.mock.config.payoutStatus = "RETURNED";
    const riley = sent
      .json()
      .payouts.find((p: any) => p.userId === s.riley.user.id).id;
    assert.equal(
      (await s.post(`/payouts/${riley}/reconcile`)).json().status,
      "RETURNED",
    );
    assert.deepEqual(s.owed(), { maya: 3000 });
    // Seeing it again changes nothing.
    await s.app.store.db
      .prepare("UPDATE fairshare_payout_ops SET status='UNCLAIMED' WHERE id=?")
      .run(riley);
    await s.post(`/payouts/${riley}/reconcile`);
    assert.deepEqual(s.owed(), { maya: 3000 });
  }));

test("resume ignores PayPal events not linked to this agreement and catches disputes from before", () =>
  run(async (s) => {
    const { captureId } = await s.pay();
    const paypal = s.mock.external(captureId, 10000);
    await s.refundEvent("pause", paypal.id, captureId);
    const insert = (id: string, status: string, action: unknown) =>
      s.app.store.db
        .prepare("INSERT INTO fairshare_webhook_inbox VALUES(?,?,?,?,NULL)")
        .run(id, `fp-${id}`, JSON.stringify(action), status);
    insert("stray", "PENDING", {
      kind: "HOLD_CAPTURE",
      providerId: "SOMEONE-ELSES",
      eventType: "PAYMENT.CAPTURE.REVERSED",
    });
    // Unsupported or unlinkable events still stop payouts, but do not block every agreement's resume.
    insert("unsupported", "PENDING", {
      kind: "RECORD_UNMATCHED",
      eventType: "UNSUPPORTED.NEW_EVENT",
      reason: "UNSUPPORTED_WEBHOOK_EVENT",
    });
    assert.deepEqual((await s.recovery()).review.blockers, []);
    // A dispute handled before disputes were recorded, never resolved.
    insert("old-dispute", "DONE", {
      kind: "HOLD_CAPTURE",
      eventType: "CUSTOMER.DISPUTE.CREATED",
      providerId: captureId,
      providerIds: [captureId],
    });
    assert.equal((await s.resume()).json().error.code, "DISPUTE_OPEN");
    insert("old-resolved", "DONE", {
      kind: "HOLD_CAPTURE",
      eventType: "CUSTOMER.DISPUTE.RESOLVED",
      providerId: captureId,
      providerIds: [captureId],
    });
    assert.equal((await s.resume()).statusCode, 200);
  }));

test("a refund in flight fails after a reversal: the part set aside for it is reversed then", () =>
  run(async (s) => {
    const { id, captureId } = await s.pay();
    s.mock.config.refundStatus = "PENDING";
    const pending = await s.post(`/payments/${id}/refund`, {
      confirmRefund: true,
      amountCents: 3000,
      requestKey: "in-flight",
    });
    await reversalEvent(s, "rev", captureId, 10000);
    const revenue = () =>
      s
        .agreement()
        .value.revenue.find((r) => r.providerCaptureId === captureId)!;
    assert.deepEqual(
      revenue().refunds!.map((r) => r.grossCents),
      [7000],
    );
    // 9700 net less 7000 reversed, split 60/40.
    assert.deepEqual(s.totals(captureId), { maya: 1620, riley: 1080 });
    // PayPal reports the refund failed: the 3000 PayPal already took back comes out now.
    s.mock.refunds.get(pending.json().providerRefundId)!.status = "FAILED";
    const failed = await s.post(`/refunds/${pending.json().id}/reconcile`);
    assert.equal(failed.json().status, "FAILED", failed.body);
    assert.deepEqual(
      revenue().refunds!.map((r) => [r.kind, r.grossCents]),
      [
        ["REVERSAL", 7000],
        ["REVERSAL", 3000],
      ],
    );
    assert.deepEqual(s.totals(captureId), { maya: 0, riley: 0 });
    assert.equal(
      (
        s.app.store.db
          .prepare("SELECT count(*) AS n FROM fairshare_reversal_holdbacks")
          .get() as any
      ).n,
      0,
    );
    // Checking again changes nothing; Resume then pays nothing from this payment.
    const settled = s.agreement().revision;
    await s.post(`/refunds/${pending.json().id}/reconcile`);
    assert.equal(s.agreement().revision, settled);
    assert.equal((await s.resume()).statusCode, 200);
    await s.setEmails();
    await s.post("/payouts/dispatch", { captureId });
    assert.equal(s.mock.counts.payoutWrites, 0);
  }));

test("replaying a reversal after its effects committed does not enlarge its holdback", () =>
  run(async (s) => {
    const { id, captureId } = await s.pay();
    s.mock.config.refundStatus = "PENDING";
    const pending = await s.post(`/payments/${id}/refund`, {
      confirmRefund: true,
      amountCents: 3000,
      requestKey: "in-flight",
    });
    await reversalEvent(s, "reversal-replay", captureId, 8000);
    const holdback = () =>
      s.app.store.db
        .prepare("SELECT cents FROM fairshare_reversal_holdbacks")
        .get() as any;
    assert.equal(holdback().cents, 1000);
    s.app.store.db
      .prepare("UPDATE fairshare_webhook_inbox SET status='PENDING' WHERE id=?")
      .run("reversal-replay");
    const replay = await reversalEvent(s, "reversal-replay", captureId, 8000);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(holdback().cents, 1000);
    s.mock.refunds.get(pending.json().providerRefundId)!.status = "FAILED";
    await s.post(`/refunds/${pending.json().id}/reconcile`);
    const refunds = s
      .agreement()
      .value.revenue.find((r) => r.providerCaptureId === captureId)!.refunds!;
    assert.equal(
      refunds.reduce((sum, refund) => sum + refund.grossCents, 0),
      8000,
    );
    assert.equal(
      (
        s.app.store.db
          .prepare("SELECT count(*) AS n FROM fairshare_reversal_holdbacks")
          .get() as any
      ).n,
      0,
    );
  }));

for (const outcome of ["COMPLETED", "FAILED"])
  test(`a partial reversal with a refund in flight is taken in full now; the refund then ${outcome}`, () =>
    run(async (s) => {
      const { id, captureId } = await s.pay();
      s.mock.config.refundStatus = "PENDING";
      const pending = await s.post(`/payments/${id}/refund`, {
        confirmRefund: true,
        amountCents: 3000,
        requestKey: "in-flight",
      });
      // 4000 reversed with 3000 in flight cannot overlap it: 10000 - 3000 leaves 7000.
      await reversalEvent(s, "rev", captureId, 4000);
      const grossTaken = () =>
        s
          .agreement()
          .value.revenue.find((r) => r.providerCaptureId === captureId)!
          .refunds!.reduce((sum, r) => sum + r.grossCents, 0);
      assert.equal(grossTaken(), 4000);
      assert.equal(
        (
          s.app.store.db
            .prepare("SELECT count(*) AS n FROM fairshare_reversal_holdbacks")
            .get() as any
        ).n,
        0,
      );
      s.mock.refunds.get(pending.json().providerRefundId)!.status = outcome;
      await s.post(`/refunds/${pending.json().id}/reconcile`);
      // PayPal took 7000 when the refund completes, 4000 when it fails.
      assert.equal(grossTaken(), outcome === "COMPLETED" ? 7000 : 4000);
      assert.deepEqual(
        s.totals(captureId),
        outcome === "COMPLETED"
          ? { maya: 1620, riley: 1080 }
          : { maya: 3420, riley: 2280 },
      );
    }));

test("a refund cut down by a reversal replays without conflict", () =>
  run(async (s) => {
    const { captureId } = await s.pay();
    await reversalEvent(s, "rev", captureId, 8000);
    const late = s.mock.external(captureId, 3000);
    assert.equal(
      (await s.refundEvent("late-1", late.id, captureId)).statusCode,
      200,
    );
    const stored = s
      .agreement()
      .value.revenue.find((r) => r.providerCaptureId === captureId)!
      .refunds!.find((r) => r.id === late.id)!;
    assert.equal(stored.grossCents, 2000);
    const revision = s.agreement().revision;
    const replay = await s.refundEvent("late-2", late.id, captureId);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(s.agreement().revision, revision);
  }));

test("offset first, payout returned later: the kept-back amount is given back on the next payment", () =>
  run(async (s) => {
    const { captureId } = await s.pay();
    await s.setEmails();
    const sent = await s.post("/payouts/dispatch", { captureId });
    // Full refund after payouts; PayPal returns its fee, so only what was paid is owed.
    s.mock.config.feeReturned = (cents) => fee(cents);
    const full = s.mock.external(captureId, 10000);
    await s.refundEvent("full", full.id, captureId);
    assert.deepEqual(s.owed(), { maya: 5820, riley: 3880 });
    await s.resume({ offsetFromFuturePayouts: true });
    const second = await s.pay();
    assert.deepEqual(s.totals(second.captureId), { maya: 0, riley: 0 });
    // Riley's first payout comes back from PayPal.
    s.mock.config.payoutStatus = "RETURNED";
    const riley = sent
      .json()
      .payouts.find((p: any) => p.userId === s.riley.user.id).id;
    await s.post(`/payouts/${riley}/reconcile`);
    assert.deepEqual(s.owed(), {});
    assert.deepEqual(s.agreement().value.creditBack, {
      [s.riley.user.id]: 3880,
    });
    assert.deepEqual((await s.recovery()).review.credits, [
      { userId: s.riley.user.id, name: "Riley", cents: 3880 },
    ]);
    const third = await s.pay();
    assert.deepEqual(s.totals(third.captureId), {
      maya: 5820,
      riley: 3880 + 3880,
    });
  }));

test("legacy refunds migrate: COMPLETED is settled by the old pause and never reversed; PENDING still blocks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fairshare-refunds-"));
  try {
    const path = join(dir, "db.sqlite");
    // 1. Payments made under the new code, then refunds recorded the old way.
    const first = await setup(path);
    const done = await first.pay();
    const inFlight = await first.pay();
    const { w, maya } = first;
    const before = first.agreement().value;
    // The old code paused the whole agreement for a completed full refund.
    first.agg.update(w.id, "collab", first.agreement().revision, (c) =>
      holdReversedRevenue(
        c,
        done.captureId,
        "Full refund",
        new Date().toISOString(),
      ),
    );
    await first.app.close();
    const legacy = new DatabaseSync(path);
    legacy.exec(
      "DROP TABLE fairshare_refund_ops;" +
        "CREATE TABLE fairshare_refund_ops(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,collaboration_id TEXT NOT NULL,payment_id TEXT NOT NULL UNIQUE,capture_id TEXT NOT NULL UNIQUE,amount INTEGER NOT NULL,request_key TEXT NOT NULL UNIQUE,provider_refund_id TEXT UNIQUE,status TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);",
    );
    const insert = legacy.prepare(
      "INSERT INTO fairshare_refund_ops VALUES(?,?,'collab',?,?,10000,?,?,?,?,'2026-01-01T00:00:00.000Z')",
    );
    insert.run(
      "old-done",
      w.id,
      done.id,
      done.captureId,
      "refund-old-done",
      "REFDONE",
      "COMPLETED",
      maya.user.id,
    );
    insert.run(
      "old-pending",
      w.id,
      inFlight.id,
      inFlight.captureId,
      "refund-old-pending",
      "REFPEND",
      "PENDING",
      maya.user.id,
    );
    legacy.close();

    // 2. Reopen: the migration runs.
    const mock = mockProvider();
    const app = await buildApp({
      dbPath: path,
      payment: {
        provider: mock.provider,
        publicOrigin: "https://callbacks.example.test",
      },
    });
    try {
      const agg = new AggregateStore(app.store.db, (f) => app.store.tx(f));
      const base = `/api/workspaces/${w.id}/collaborations/collab`;
      const post = (suffix: string, payload: any = {}) =>
        app.inject({
          method: "POST",
          url: base + suffix,
          headers: auth(maya.token),
          payload,
        });
      const rows = Object.fromEntries(
        (
          app.store.db
            .prepare("SELECT * FROM fairshare_refund_ops")
            .all() as any[]
        ).map((r) => [r.id, r]),
      );
      assert.equal(rows["old-done"].client_key, "full");
      assert.equal(rows["old-done"].settled_by_hold, 1);
      assert.equal(rows["old-done"].applied_at, "2026-01-01T00:00:00.000Z");
      assert.equal(rows["old-pending"].settled_by_hold, 0);
      assert.equal(rows["old-pending"].applied_at, null);
      // PENDING is still moving money: resume waits for it.
      const refused = await post("/payments/resume", {
        expectedRevision: agg.read(w.id, "collab").revision,
      });
      assert.equal(
        refused.json().error?.code,
        "REFUND_UNRECONCILED",
        refused.body,
      );
      // PayPal reports it failed; now resume works.
      mock.refunds.set("REFPEND", {
        id: "REFPEND",
        status: "FAILED",
        amountCents: 10000,
        currency: "USD",
        captureId: inFlight.captureId,
        reference: "refund-old-pending",
      });
      assert.equal(
        (await post("/refunds/old-pending/reconcile")).json().status,
        "FAILED",
      );
      // Re-checking the completed legacy refund never reverses it by the split.
      mock.refunds.set("REFDONE", {
        id: "REFDONE",
        status: "COMPLETED",
        amountCents: 10000,
        currency: "USD",
        captureId: done.captureId,
        reference: "refund-old-done",
      });
      assert.equal((await post("/refunds/old-done/reconcile")).statusCode, 200);
      const resumed = await post("/payments/resume", {
        expectedRevision: agg.read(w.id, "collab").revision,
      });
      assert.equal(resumed.statusCode, 200, resumed.body);
      const after = agg.read(w.id, "collab").value;
      assert.equal(after.reviewHold, false);
      for (const captureId of [done.captureId, inFlight.captureId]) {
        const revenue = after.revenue.find(
          (r) => r.providerCaptureId === captureId,
        )!;
        assert.equal(revenue.refunds, undefined);
        assert.deepEqual(
          revenue.allocations.map((a) => a.totalCents),
          before.revenue
            .find((r) => r.providerCaptureId === captureId)!
            .allocations.map((a) => a.totalCents),
        );
      }
      // The failed refund's payment pays out again. The fully refunded one never does: its money is gone.
      assert.equal(
        (await post("/payouts/dispatch", { captureId: inFlight.captureId }))
          .statusCode,
        200,
      );
      const stopped = await post("/payouts/dispatch", {
        captureId: done.captureId,
      });
      assert.equal(stopped.statusCode, 400);
      assert.match(stopped.json().error.message, /refund/);
      // And it cannot be refunded again here.
      const again = await post(`/payments/${done.id}/refund`, {
        confirmFullRefund: true,
      });
      assert.equal(again.json().id, "old-done");
      assert.equal(again.json().outcome, "PAUSED_FOR_REVIEW");
      assert.equal(
        (
          await post(`/payments/${done.id}/refund`, {
            confirmRefund: true,
            amountCents: 100,
            requestKey: "more",
          })
        ).json().error.code,
        "REFUND_EXCEEDS_PAYMENT",
      );
      assert.equal(mock.counts.refundWrites, 0);
    } finally {
      await app.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
