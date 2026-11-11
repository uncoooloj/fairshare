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
import type { PaymentProvider } from "../src/paymentRoutes.js";

async function fixture() {
  let reference = "",
    refundKey = "",
    refundWrites = 0,
    payoutWrites = 0;
  const capture = () => ({
    id: "CAP",
    orderId: "ORDER",
    reference,
    amountCents: 10000,
    currency: "USD",
    status: "COMPLETED",
    accounting: { feeCents: 300, netCents: 9700 },
  });
  const provider: PaymentProvider = {
    createOrder: async (input) => {
      reference = input.reference;
      return {
        id: "ORDER",
        approvalUrl: "https://www.sandbox.paypal.com/approve",
      };
    },
    captureOrder: async () => capture(),
    getOrder: async () => ({ status: "COMPLETED", capture: capture() }),
    createPayout: async () => {
      payoutWrites++;
      return { batchId: "BATCH", status: "PENDING" };
    },
    getPayout: async () => ({
      batchId: "BATCH",
      itemId: "ITEM",
      status: "SUCCESS",
    }),
    verifyWebhook: async () => true,
    refundCapture: async (_capture, amount, currency, key) => {
      refundWrites++;
      refundKey = key;
      return {
        id: "REFUND",
        amountCents: amount,
        currency,
        status: "COMPLETED",
      };
    },
    getRefund: async () => ({
      id: "REFUND",
      captureId: "CAP",
      reference: refundKey,
      amountCents: 10000,
      currency: "USD",
      status: "COMPLETED",
    }),
  };
  const app = await buildApp({
    dbPath: ":memory:",
    payment: { provider, publicOrigin: "https://callbacks.example.test" },
  });
  const owner = app.store.register({
    name: "Owner",
    email: "owner@example.test",
    password: "Correct-Horse-123",
  });
  const outsider = app.store.register({
    name: "Other",
    email: "other@example.test",
    password: "Correct-Horse-123",
  });
  const workspace = app.store.createWorkspace(owner.user.id, "Test");
  const aggregates = new AggregateStore(app.store.db, (f) => app.store.tx(f));
  const now = new Date().toISOString();
  let agreement = createCollaboration(
    {
      id: "agreement",
      name: "Test",
      members: [
        {
          userId: owner.user.id,
          displayName: "Owner",
          role: MemberRole.ORGANIZER,
        },
      ],
    },
    owner.user.id,
    now,
  );
  agreement = proposeVersion(
    agreement,
    {
      currency: "USD",
      feePolicy: FeePolicy.BEFORE_SPLIT,
      shares: [{ userId: owner.user.id, basisPoints: 10000 }],
      source: {
        origin: RuleOrigin.HUMAN_PROPOSAL,
        documentId: "doc",
        clause: "1",
        excerpt: "test",
      },
      unresolvedQuestions: [],
    },
    owner.user.id,
    now,
  );
  agreement = sendForReview(agreement, 1, owner.user.id, now);
  agreement = approveVersion(agreement, 1, owner.user.id, now);
  agreement = activateVersion(agreement, 1, owner.user.id, now);
  aggregates.insert(workspace.id, agreement);
  const base = `/api/workspaces/${workspace.id}/collaborations/agreement`;
  const headers = { authorization: `Bearer ${owner.token}` };
  const post = (suffix: string, payload = {}) =>
    app.inject({ method: "POST", url: base + suffix, headers, payload });
  const created = await post("/payments", {
    amountCents: 10000,
    requestKey: "payment",
  });
  assert.equal(created.statusCode, 200, created.body);
  const paymentId = created.json().id;
  const paid = await post(`/payments/${paymentId}/capture`);
  assert.equal(paid.statusCode, 200, paid.body);
  const reserve = (
    status: string,
    batch: string | null = null,
    item: string | null = null,
    userId = owner.user.id,
  ) =>
    app.store.db
      .prepare(
        "INSERT INTO fairshare_payout_ops(id,workspace_id,collaboration_id,capture_id,user_id,recipient_id,amount,status,batch_id,item_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        `payout-${userId}`,
        workspace.id,
        "agreement",
        "CAP",
        userId,
        "ABCDEFGHIJKLM",
        9700,
        status,
        batch,
        item,
      );
  const refund = () =>
    post(`/payments/${paymentId}/refund`, { confirmFullRefund: true });
  return {
    app,
    provider,
    owner,
    outsider,
    workspace,
    aggregates,
    base,
    headers,
    post,
    reserve,
    refund,
    counts: () => ({ refundWrites, payoutWrites }),
  };
}

test("full refund before payouts cancels unsent payout rows, reverses the split and never replays", async () => {
  const f = await fixture();
  try {
    for (const status of ["WAITING_RECIPIENT", "AUTO_HELD", "HELD"])
      f.reserve(status, null, null, status);
    const result = await f.refund();
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().status, "COMPLETED");
    assert.equal((await f.refund()).json().id, result.json().id);
    assert.equal(f.counts().refundWrites, 1);
    const payouts = f.app.store.db
      .prepare("SELECT status,amount,updated_at FROM fairshare_payout_ops")
      .all();
    assert.equal(payouts.length, 3);
    assert.ok(
      payouts.every(
        (p) =>
          p.status === "CANCELLED_FOR_REFUND" &&
          p.amount === 9700 &&
          Number.isFinite(Date.parse(p.updated_at)),
      ),
    );
    const after = f.aggregates.read(f.workspace.id, "agreement").value;
    assert.equal(after.revenue[0].allocations[0].totalCents, 0);
    // PayPal kept its fee (no breakdown), so the 300 fee is now owed and payouts pause.
    assert.equal(result.json().outcome, "PAUSED_FOR_REVIEW");
    assert.equal(after.reviewHold, true);
    assert.deepEqual({ ...after.owedBack }, { [f.owner.user.id]: 300 });
    assert.equal(
      (await f.post("/payouts/dispatch", { captureId: "CAP" })).statusCode,
      400,
    );
    assert.equal(f.counts().payoutWrites, 0);
  } finally {
    await f.app.close();
  }
});

test("a reserved payout counts as started, so the organizer cannot refund that payment here", async () => {
  const f = await fixture();
  try {
    f.reserve("RESERVED");
    const response = await f.refund();
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error.code, "REFUND_AFTER_PAYOUT_UNSUPPORTED");
    assert.equal(f.counts().refundWrites, 0);
  } finally {
    await f.app.close();
  }
});

test("provider-linked, submitting, unknown and terminal payouts block refund without cancelling any other reservation", async () => {
  const f = await fixture();
  try {
    f.reserve("WAITING_RECIPIENT", null, null, "safe");
    f.reserve("SUBMITTING", null, null, "unsafe");
    for (const [status, batch, item] of [
      ["SUBMITTING", null, null],
      ["OUTCOME_UNKNOWN", null, null],
      ["FAILED", null, null],
      ["SUCCESS", null, null],
      ["WAITING_RECIPIENT", "BATCH", null],
      ["AUTO_HELD", null, "ITEM"],
    ]) {
      f.app.store.db
        .prepare(
          "UPDATE fairshare_payout_ops SET status=?,batch_id=?,item_id=? WHERE user_id='unsafe'",
        )
        .run(status, batch, item);
      const response = await f.refund();
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(
        response.json().error.code,
        "REFUND_AFTER_PAYOUT_UNSUPPORTED",
      );
      assert.equal(
        f.app.store.db
          .prepare(
            "SELECT status FROM fairshare_payout_ops WHERE user_id='safe'",
          )
          .get().status,
        "WAITING_RECIPIENT",
      );
      assert.equal(
        f.aggregates.read(f.workspace.id, "agreement").value.reviewHold,
        false,
      );
    }
    assert.equal(f.counts().refundWrites, 0);
    assert.equal(
      f.app.store.db
        .prepare("SELECT count(*) AS n FROM fairshare_refund_ops")
        .get().n,
      0,
    );
  } finally {
    await f.app.close();
  }
});

test("the refund reservation blocks that payment's payouts during provider I/O, including an uncertain result", async () => {
  const f = await fixture();
  try {
    f.reserve("WAITING_RECIPIENT");
    let calls = 0;
    const seen: unknown[] = [];
    f.provider.refundCapture = async () => {
      calls++;
      seen.push(
        f.app.store.db.prepare("SELECT status FROM fairshare_payout_ops").get()
          .status,
        f.aggregates.read(f.workspace.id, "agreement").value.reviewHold,
        (await f.refund()).json().status,
        (await f.post("/payouts/dispatch", { captureId: "CAP" })).statusCode,
      );
      throw new Error("provider timeout after possible acceptance");
    };
    assert.equal((await f.refund()).json().status, "OUTCOME_UNKNOWN");
    // Only this payment waits: the row is untouched and the agreement is not paused.
    assert.deepEqual(seen, ["WAITING_RECIPIENT", false, "SUBMITTING", 400]);
    assert.equal((await f.refund()).json().status, "OUTCOME_UNKNOWN");
    assert.equal(calls, 1);
    assert.equal(
      (await f.post("/payouts/dispatch", { captureId: "CAP" })).statusCode,
      400,
    );
    assert.equal(f.counts().payoutWrites, 0);
  } finally {
    await f.app.close();
  }
});

test("organizer sees and retries only their verified scoped event; unknown event never becomes a dismissible hold", async () => {
  const f = await fixture();
  try {
    const insert = (id: string, action: unknown) =>
      f.app.store.db
        .prepare(
          "INSERT INTO fairshare_webhook_inbox VALUES(?,?,?,'PENDING','UNMATCHED_EVENT')",
        )
        .run(id, `fingerprint-${id}`, JSON.stringify(action));
    insert("own-event", {
      kind: "HOLD_CAPTURE",
      providerId: "CAP",
      eventType: "PAYMENT.CAPTURE.REVERSED",
      reason: "PAYMENT.CAPTURE.REVERSED",
    });
    insert("external-event", {
      kind: "HOLD_CAPTURE",
      providerId: "EXTERNAL",
      eventType: "PAYMENT.CAPTURE.REVERSED",
    });
    insert("unknown-event", {
      kind: "RECORD_UNMATCHED",
      eventType: "UNSUPPORTED.NEW_EVENT",
      reason: "UNSUPPORTED_WEBHOOK_EVENT",
    });
    const listing = await f.app.inject({
      url: f.base + "/recovery",
      headers: f.headers,
    });
    assert.equal(listing.statusCode, 200, listing.body);
    assert.deepEqual(
      listing.json().events.map((e: any) => e.id),
      ["own-event"],
    );
    assert.equal(listing.json().providerHold, true);
    assert.equal((await f.refund()).json().error.code, "PAYMENT_HOLD");
    assert.equal(
      (await f.post("/recovery/events/external-event/reconcile")).statusCode,
      404,
    );
    assert.equal(
      (await f.post("/recovery/events/unknown-event/reconcile")).statusCode,
      404,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: f.base + "/recovery/events/own-event/reconcile",
          headers: { authorization: `Bearer ${f.outsider.token}` },
          payload: {},
        })
      ).statusCode,
      404,
    );
    const result = await f.post("/recovery/events/own-event/reconcile");
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().status, "DONE");
    assert.equal(
      f.aggregates.read(f.workspace.id, "agreement").value.reviewHold,
      true,
    );
    assert.equal(
      f.app.store.db
        .prepare(
          "SELECT status FROM fairshare_webhook_inbox WHERE id='unknown-event'",
        )
        .get().status,
      "PENDING",
    );
    assert.deepEqual(f.counts(), { refundWrites: 0, payoutWrites: 0 });
  } finally {
    await f.app.close();
  }
});
