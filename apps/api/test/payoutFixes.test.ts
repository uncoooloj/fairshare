import test from "node:test";
import assert from "node:assert/strict";
import { buildApp, type AppOptions } from "../src/app.js";
import { AggregateStore } from "../src/fairshare.js";
import {
  PaymentConfirmation,
  PayoutWaitReason,
  WEBHOOK_NOT_CONFIGURED_MESSAGE,
  type PaymentProvider,
} from "../src/paymentRoutes.js";
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

const ORIGIN = "https://callbacks.example.test";
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Mocked PayPal only: nothing here reaches the network. */
function mockProvider(extra: Partial<PaymentProvider> = {}) {
  const sent: { recipientId: string; amountCents: number }[] = [];
  let reference = "";
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
      reference = input.reference;
      return {
        id: "ORDER1",
        approvalUrl: "https://www.sandbox.paypal.com/approve",
      };
    },
    captureOrder: async () => ({ ...capture, reference }),
    getOrder: async () => ({
      status: "COMPLETED",
      capture: { ...capture, reference },
    }),
    createPayout: async (input) => {
      sent.push({
        recipientId: input.recipientId,
        amountCents: input.amountCents,
      });
      return { batchId: `BATCH${sent.length}`, status: "PENDING" };
    },
    getPayout: async (batchId) => ({
      batchId,
      itemId: "ITEM",
      status: "PENDING",
    }),
    verifyWebhook: async () => true,
    ...extra,
  };
  return { provider, sent };
}

/** Two people, 60/40, both approved and active: Maya organizes, Riley collaborates. */
async function setup(
  options: Partial<AppOptions["payment"]> = {},
  providerExtra: Partial<PaymentProvider> = {},
) {
  const { provider, sent } = mockProvider(providerExtra);
  const app = await buildApp({
    dbPath: ":memory:",
    payment: { provider, publicOrigin: ORIGIN, ...options },
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
  const setEmail = (token: string, email: string) =>
    app.inject({
      method: "PUT",
      url: "/api/auth/payout-account",
      headers: auth(token),
      payload: { email },
    });
  const pay = async () => {
    const id = (
      await post("/payments", { amountCents: 10000, requestKey: "one" })
    ).json().id;
    const r = await post(`/payments/${id}/capture`);
    assert.equal(r.json().confirmed, true, r.body);
  };
  const ops = () =>
    app.store.db
      .prepare(
        "SELECT user_id,status,amount FROM fairshare_payout_ops ORDER BY amount DESC",
      )
      .all() as { user_id: string; status: string; amount: number }[];
  const dispatch = () => post("/payouts/dispatch", { captureId: "CAP1" });
  return {
    app,
    maya,
    riley,
    w,
    agg,
    base,
    post,
    setEmail,
    pay,
    ops,
    dispatch,
    sent,
    provider,
  };
}

test("one missing payout email holds only that person; they are paid once after adding it", async () => {
  const s = await setup();
  try {
    await s.pay();
    await s.setEmail(s.maya.token, "maya.pay@example.test");
    const first = await s.dispatch();
    assert.equal(first.statusCode, 200, first.body);
    const byUser = Object.fromEntries(
      first.json().payouts.map((p: any) => [p.userId, p]),
    );
    assert.equal(byUser[s.maya.user.id].status, "PENDING");
    assert.equal(byUser[s.riley.user.id].status, "WAITING_RECIPIENT");
    assert.equal(
      byUser[s.riley.user.id].reason,
      PayoutWaitReason.NEEDS_PAYOUT_EMAIL,
    );
    assert.deepEqual(s.sent, [
      { recipientId: "maya.pay@example.test", amountCents: 5820 },
    ]);

    // Pressing again before Riley is ready never re-sends Maya.
    await s.dispatch();
    assert.equal(s.sent.length, 1);

    await s.setEmail(s.riley.token, "riley.pay@example.test");
    const second = await s.dispatch();
    assert.equal(second.statusCode, 200, second.body);
    assert.deepEqual(
      second
        .json()
        .payouts.map((p: any) => p.status)
        .sort(),
      ["PENDING", "PENDING"],
    );
    await s.dispatch();
    assert.deepEqual(s.sent, [
      { recipientId: "maya.pay@example.test", amountCents: 5820 },
      { recipientId: "riley.pay@example.test", amountCents: 3880 },
    ]);
    assert.equal(s.ops().length, 2, "one reservation per (capture, person)");
  } finally {
    await s.app.close();
  }
});

test("manual dispatch sends rows parked by automatic payouts once their blocker is resolved", async () => {
  const s = await setup();
  try {
    await s.pay();
    // Rows exactly as the automatic worker parks them.
    for (const [user, status, amount] of [
      [s.maya.user.id, "AUTO_HELD", 5820],
      [s.riley.user.id, "WAITING_RECIPIENT", 3880],
    ] as const)
      s.app.store.db
        .prepare(
          "INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_type,recipient_id,amount,status) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          `auto-${status}`,
          s.w.id,
          "collab",
          "CAP1",
          user,
          "PAYPAL_ID",
          "",
          amount,
          status,
        );

    // Before anyone has an email: nothing is sent and each row says why.
    let r = await s.dispatch();
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(
      r.json().payouts.map((p: any) => [p.status, p.reason]),
      [
        ["WAITING_RECIPIENT", PayoutWaitReason.NEEDS_PAYOUT_EMAIL],
        ["WAITING_RECIPIENT", PayoutWaitReason.NEEDS_PAYOUT_EMAIL],
      ],
    );
    assert.equal(s.sent.length, 0);

    await s.setEmail(s.maya.token, "maya.pay@example.test");
    await s.setEmail(s.riley.token, "riley.pay@example.test");
    // Two concurrent presses still claim each reservation once.
    const [a, b] = await Promise.all([s.dispatch(), s.dispatch()]);
    assert.equal(a.statusCode, 200, a.body);
    assert.equal(b.statusCode, 200, b.body);
    await s.dispatch();
    assert.equal(s.sent.length, 2);
    assert.deepEqual(
      s.ops().map((o) => o.status),
      ["PENDING", "PENDING"],
    );
    assert.deepEqual(
      (
        s.app.store.db
          .prepare("SELECT id FROM fairshare_payout_ops ORDER BY id")
          .all() as any[]
      ).map((r) => r.id),
      ["auto-AUTO_HELD", "auto-WAITING_RECIPIENT"],
      "the existing reservation is reused, not duplicated",
    );
  } finally {
    await s.app.close();
  }
});

test("agreement-wide holds still block everyone, even when some people are ready", async () => {
  for (const hold of ["refund", "adverse", "review"] as const) {
    const s = await setup();
    try {
      await s.pay();
      await s.setEmail(s.maya.token, "maya.pay@example.test");
      if (hold === "refund")
        s.app.store.db
          .prepare(
            "INSERT INTO fairshare_refund_ops(id,workspace_id,collaboration_id,payment_id,capture_id,amount,request_key,provider_refund_id,status,created_by,created_at,client_key) VALUES('r1',?,'collab','p1','CAP1',10000,'rk',NULL,'PENDING','x','now','full')",
          )
          .run(s.w.id);
      if (hold === "adverse")
        s.app.store.db
          .prepare(
            "INSERT INTO fairshare_webhook_inbox VALUES('ev','fp',?,'PENDING',NULL)",
          )
          .run(JSON.stringify({ kind: "HOLD_CAPTURE", providerId: "CAP1" }));
      if (hold === "review") {
        const record = s.agg.read(s.w.id, "collab");
        record.value.reviewHold = true;
        s.app.store.db
          .prepare(
            "UPDATE fairshare_collaborations SET value=? WHERE workspace_id=? AND id=?",
          )
          .run(JSON.stringify(record.value), s.w.id, "collab");
      }
      const r = await s.dispatch();
      assert.equal(r.statusCode, 400, `${hold}: ${r.body}`);
      assert.equal(r.json().error.code, "PAYMENT_HOLD");
      assert.equal(s.sent.length, 0, hold);
      assert.equal(s.ops().length, 0, `${hold}: nothing reserved`);
    } finally {
      await s.app.close();
    }
  }
});

test("an unsupported verified webhook blocks manual dispatch", async () => {
  const s = await setup();
  try {
    await s.pay();
    await s.setEmail(s.maya.token, "maya.pay@example.test");
    s.app.store.db
      .prepare(
        "INSERT INTO fairshare_webhook_inbox VALUES('unsupported','fp',?,'PENDING',NULL)",
      )
      .run(
        JSON.stringify({
          kind: "RECORD_UNMATCHED",
          reason: "UNSUPPORTED_WEBHOOK_EVENT",
          eventType: "PAYMENT.CAPTURE.UNKNOWN",
        }),
      );
    const r = await s.dispatch();
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().error.code, "PAYMENT_HOLD");
    assert.equal(s.sent.length, 0);
  } finally {
    await s.app.close();
  }
});

test("a known hold for another capture does not block manual dispatch", async () => {
  const s = await setup();
  try {
    await s.pay();
    await s.setEmail(s.maya.token, "maya.pay@example.test");
    s.app.store.db
      .prepare("INSERT INTO fairshare_captures VALUES(?,?,?)")
      .run("CAP-OTHER", s.w.id, "other-agreement");
    s.app.store.db
      .prepare(
        "INSERT INTO fairshare_webhook_inbox VALUES('other','fp',?,'PENDING',NULL)",
      )
      .run(JSON.stringify({ kind: "HOLD_CAPTURE", providerId: "CAP-OTHER" }));
    const r = await s.dispatch();
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(s.sent.length, 1);
  } finally {
    await s.app.close();
  }
});

test("a pending webhook added during the first payout parks the next reservation", async () => {
  const s = await setup();
  try {
    await s.pay();
    await s.setEmail(s.maya.token, "maya.pay@example.test");
    await s.setEmail(s.riley.token, "riley.pay@example.test");
    let calls = 0;
    let release!: () => void;
    let entered!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const firstWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.provider.createPayout = async () => {
      calls++;
      if (calls === 1) {
        entered();
        await firstWrite;
      }
      return { batchId: `BATCH${calls}`, status: "PENDING" };
    };
    const dispatch = s.dispatch();
    await firstStarted;
    s.app.store.db
      .prepare(
        "INSERT INTO fairshare_webhook_inbox VALUES('race','fp',?,'PENDING',NULL)",
      )
      .run(
        JSON.stringify({
          kind: "RECORD_UNMATCHED",
          reason: "UNSUPPORTED_WEBHOOK_EVENT",
          eventType: "PAYMENT.CAPTURE.UNKNOWN",
        }),
      );
    release();
    const r = await dispatch;
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(calls, 1);
    assert.deepEqual(
      r
        .json()
        .payouts.map((p: any) => p.status)
        .sort(),
      ["AUTO_HELD", "PENDING"],
    );
    assert.equal(
      s.app.store.db
        .prepare("SELECT status FROM fairshare_payout_ops WHERE user_id=?")
        .get(s.riley.user.id).status,
      "AUTO_HELD",
    );
  } finally {
    await s.app.close();
  }
});

test("missing PAYPAL_WEBHOOK_ID fails closed, logs one clear error and tells the organizer", async () => {
  const errors: [string, string][] = [];
  const { provider } = mockProvider({
    webhookConfigured: false,
    verifyWebhook: async () => {
      const { PayPalError } = await import("@fairshare/payments");
      throw new PayPalError("PAYPAL_WEBHOOK_NOT_CONFIGURED", 503);
    },
  });
  const app = await buildApp({
    dbPath: ":memory:",
    payment: { provider, onConfigurationError: (c, m) => errors.push([c, m]) },
  });
  try {
    for (const id of ["e1", "e2"]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/paypal/webhook",
        payload: { id, event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} },
      });
      assert.equal(r.statusCode, 503);
      assert.equal(r.json().error.code, "PAYPAL_WEBHOOK_NOT_CONFIGURED");
    }
    assert.deepEqual(errors, [
      ["PAYPAL_WEBHOOK_NOT_CONFIGURED", WEBHOOK_NOT_CONFIGURED_MESSAGE],
    ]);
    assert.doesNotMatch(errors[0][1], /secret|token|client_id/i);
    assert.equal(
      (
        app.store.db
          .prepare("SELECT COUNT(*) AS n FROM fairshare_webhook_inbox")
          .get() as any
      ).n,
      0,
      "nothing unverified is stored",
    );
  } finally {
    await app.close();
  }
});

test("payment setup reports real automatic-payout and webhook capability to members only", async () => {
  const off = await setup();
  try {
    const read = (token: string) =>
      off.app.inject({
        url: `${off.base}/payments/setup`,
        headers: auth(token),
      });
    assert.deepEqual((await read(off.maya.token)).json(), {
      automaticPayouts: false,
      payoutsReady: true,
      paymentConfirmation: PaymentConfirmation.READY,
    });
    const outsider = off.app.store.register({
      name: "Out",
      email: "out@example.test",
      password: "Correct-Horse-123",
    });
    assert.equal((await read(outsider.token)).statusCode, 404);
  } finally {
    await off.app.close();
  }
  const on = await setup({
    automaticPayoutsEnabled: true,
    reconciliation: { enabled: true, externalScheduling: true },
  });
  try {
    const r = await on.app.inject({
      url: `${on.base}/payments/setup`,
      headers: auth(on.riley.token),
    });
    assert.equal(r.json().automaticPayouts, true);
    assert.equal(r.json().payoutsReady, true);
  } finally {
    await on.app.close();
  }
  const payoutUnavailable = await setup(
    {
      automaticPayoutsEnabled: true,
      reconciliation: { enabled: true, externalScheduling: true },
    },
    { payoutsReady: false },
  );
  try {
    const r = await payoutUnavailable.app.inject({
      url: `${payoutUnavailable.base}/payments/setup`,
      headers: auth(payoutUnavailable.maya.token),
    });
    assert.equal(r.json().automaticPayouts, false);
    assert.equal(r.json().payoutsReady, false);
  } finally {
    await payoutUnavailable.app.close();
  }
  const unverifiable = await setup(
    { onConfigurationError: () => {} },
    { webhookConfigured: false },
  );
  try {
    const r = await unverifiable.app.inject({
      url: `${unverifiable.base}/payments/setup`,
      headers: auth(unverifiable.maya.token),
    });
    assert.equal(
      r.json().paymentConfirmation,
      PaymentConfirmation.WEBHOOK_NOT_CONFIGURED,
    );
  } finally {
    await unverifiable.app.close();
  }
});

test("wizard switch-on after the last approval plus automatic payouts pays only ready people", async () => {
  const { provider, sent } = mockProvider();
  const app = await buildApp({
    dbPath: ":memory:",
    payment: {
      provider,
      publicOrigin: ORIGIN,
      automaticPayoutsEnabled: true,
      reconciliation: { enabled: true, externalScheduling: true },
    },
  });
  try {
    const register = async (email: string) =>
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {
            email,
            name: email.split("@")[0],
            password: "Correct-Horse-123",
          },
        })
      ).json();
    const maya = await register("maya@example.test");
    const riley = await register("riley@example.test");
    const h = (u: any) => auth(u.token);
    const w = app.store.createWorkspace(maya.user.id, "Team");
    const url = `/api/workspaces/${w.id}/collaborations`;
    const id = (
      await app.inject({
        method: "POST",
        url,
        headers: h(maya),
        payload: { name: "Midnight" },
      })
    ).json().id;
    const agreement = `${url}/${id}`;
    const read = async () =>
      (await app.inject({ url: agreement, headers: h(maya) })).json();
    const text = "Revenue splits 60% to Maya and 40% to Riley after fees.";
    const documentId = (
      await app.inject({
        method: "POST",
        url: `${agreement}/documents`,
        headers: h(maya),
        payload: { text },
      })
    ).json().documentId;
    const added = await app.inject({
      method: "POST",
      url: `${agreement}/people`,
      headers: h(maya),
      payload: {
        expectedRevision: (await read()).revision,
        name: "Riley",
        email: "riley@example.test",
      },
    });
    assert.equal(added.statusCode, 201, added.body);
    const { invitation } = added.json();
    const sentForApproval = await app.inject({
      method: "POST",
      url: `${agreement}/submit`,
      headers: h(maya),
      payload: {
        expectedRevision: (await read()).revision,
        rules: {
          currency: "USD",
          feePolicy: FeePolicy.BEFORE_SPLIT,
          shares: [
            { userId: maya.user.id, basisPoints: 6000 },
            { userId: `pending:${invitation.id}`, basisPoints: 4000 },
          ],
          source: {
            origin: RuleOrigin.SOURCE_CLAUSE,
            documentId,
            clause: "1",
            excerpt: text,
          },
          unresolvedQuestions: [],
        },
      },
    });
    assert.equal(sentForApproval.statusCode, 200, sentForApproval.body);
    await app.inject({
      method: "POST",
      url: "/api/agreement-invitations/accept",
      headers: h(riley),
      payload: { token: invitation.token },
    });
    const approved = await app.inject({
      method: "POST",
      url: `${agreement}/versions/1/approve`,
      headers: h(riley),
      payload: { expectedRevision: (await read()).revision },
    });
    assert.equal(
      approved.json().value.activeVersionId,
      1,
      "switched on by the last approval",
    );

    const order = await app.inject({
      method: "POST",
      url: `${agreement}/payments`,
      headers: h(maya),
      payload: { amountCents: 10000, requestKey: "first" },
    });
    await app.inject({
      method: "POST",
      url: `${agreement}/payments/${order.json().id}/capture`,
      headers: h(maya),
      payload: {},
    });
    await app.inject({
      method: "PUT",
      url: "/api/auth/payout-account",
      headers: h(maya),
      payload: { email: "maya.pay@example.test" },
    });
    const worker = (app as any).paymentReconciliation;
    await worker.tick();
    await worker.tick();
    assert.deepEqual(sent, [
      { recipientId: "maya.pay@example.test", amountCents: 5820 },
    ]);
    const riley1 = app.store.db
      .prepare("SELECT status FROM fairshare_payout_ops WHERE user_id=?")
      .get(riley.user.id) as any;
    assert.equal(riley1.status, "WAITING_RECIPIENT");

    await app.inject({
      method: "PUT",
      url: "/api/auth/payout-account",
      headers: h(riley),
      payload: { email: "riley.pay@example.test" },
    });
    // The next scheduled run (30s later) picks Riley up.
    app.store.db.exec("UPDATE fairshare_reconciliation_jobs SET next_run=0");
    await worker.tick();
    await worker.tick();
    assert.deepEqual(sent, [
      { recipientId: "maya.pay@example.test", amountCents: 5820 },
      { recipientId: "riley.pay@example.test", amountCents: 3880 },
    ]);
  } finally {
    await app.close();
  }
});
