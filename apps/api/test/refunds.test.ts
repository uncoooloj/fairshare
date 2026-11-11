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
      status: "PENDING",
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
      status: "COMPLETED",
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

test("the first refund table (one refund per payment) is migrated with its rows kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fairshare-refunds-"));
  try {
    const path = join(dir, "db.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(
      "CREATE TABLE fairshare_refund_ops(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,collaboration_id TEXT NOT NULL,payment_id TEXT NOT NULL UNIQUE,capture_id TEXT NOT NULL UNIQUE,amount INTEGER NOT NULL,request_key TEXT NOT NULL UNIQUE,provider_refund_id TEXT UNIQUE,status TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);" +
        "INSERT INTO fairshare_refund_ops VALUES('old','w','c','p','CAP9',100,'refund-old','REF9','COMPLETED','u','then');",
    );
    legacy.close();
    const s = await setup(path);
    try {
      const row = s.app.store.db
        .prepare("SELECT * FROM fairshare_refund_ops WHERE id='old'")
        .get() as any;
      assert.equal(row.client_key, "full");
      assert.equal(row.applied_at, null);
      assert.equal(row.provider_refund_id, "REF9");
      // A second refund on the same payment is now allowed by the table.
      s.app.store.db
        .prepare(
          "INSERT INTO fairshare_refund_ops(id,workspace_id,collaboration_id,payment_id,capture_id,amount,request_key,status,created_by,created_at,client_key) VALUES('new','w','c','p','CAP9',50,'refund-new','SUBMITTING','u','now','k')",
        )
        .run();
    } finally {
      await s.app.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
