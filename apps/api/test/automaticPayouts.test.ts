import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { PayPalError } from "@fairshare/payments";
import { automaticPayouts } from "../src/automaticPayouts.js";

function fixture(createPayout: any = async () => ({ batchId: "batch" })) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE fairshare_captures(provider_capture_id TEXT PRIMARY KEY,workspace_id TEXT,collaboration_id TEXT);
  INSERT INTO fairshare_captures VALUES('capture','workspace','agreement');
  CREATE TABLE fairshare_recipients(workspace_id TEXT,user_id TEXT,paypal_id TEXT);
  INSERT INTO fairshare_recipients VALUES('workspace','one','ABCDEFGHIJKLM');
  CREATE TABLE fairshare_refund_ops(id TEXT,capture_id TEXT);
  CREATE TABLE fairshare_webhook_inbox(action TEXT,status TEXT);
  CREATE TABLE fairshare_payout_ops(id TEXT PRIMARY KEY,workspace_id TEXT,collaboration_id TEXT,capture_id TEXT,user_id TEXT,recipient_id TEXT,amount INTEGER,status TEXT,batch_id TEXT,UNIQUE(capture_id,user_id));`);
  const agreement: any = {
    members: [{ userId: "one" }, { userId: "two" }],
    reviewHold: false,
    versions: [{ id: 1, approvals: { one: "yes", two: "yes" } }],
    revenue: [
      {
        providerCaptureId: "capture",
        versionId: 1,
        allocations: [
          { userId: "one", totalCents: 60, status: "ALLOCATED" },
          { userId: "two", totalCents: 40, status: "ALLOCATED" },
        ],
      },
    ],
  };
  const app: any = {
    store: {
      db,
      audit: () => {},
      tx: (f: any) => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const r = f();
          db.exec("COMMIT");
          return r;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
    },
  };
  const aggregate: any = { read: () => ({ value: agreement }) };
  const service = automaticPayouts(app, aggregate, { createPayout } as any);
  const run = async () => {
    for (const job of service.discover())
      await service.dispatch(job.id, () => {});
  };
  return { db, agreement, service, run };
}
test("missing destination holds only its item; readiness later sends exactly once", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return { batchId: "batch" };
  });
  await f.run();
  assert.equal(calls, 1);
  assert.equal(
    f.db
      .prepare("SELECT status FROM fairshare_payout_ops WHERE user_id='two'")
      .get()!.status,
    "WAITING_RECIPIENT",
  );
  f.db.exec(
    "INSERT INTO fairshare_recipients VALUES('workspace','two','NOPQRSTUVWXYZ')",
  );
  await f.run();
  await f.run();
  assert.equal(calls, 2);
  f.db.close();
});
test("a hold after claim is retained without a duplicate payout", async () => {
  let calls = 0,
    release!: () => void;
  const f = fixture(async () => {
    calls++;
    await new Promise<void>((r) => (release = r));
    return { batchId: "batch" };
  });
  const job = f.service.discover()[0];
  const pending = f.service.dispatch(job.id, () => {});
  await f.service.dispatch(job.id, () => {});
  assert.equal(calls, 1);
  f.agreement.reviewHold = true;
  release();
  await pending;
  assert.equal(f.agreement.reviewHold, true);
  await f.service.dispatch(job.id, () => {});
  await f.run();
  assert.equal(calls, 1);
  f.db.close();
});
test("ambiguous provider error stays unknown across discovery and restart", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    throw new Error("timeout");
  });
  await f.run();
  await f.run();
  assert.equal(calls, 1);
  assert.equal(
    f.db
      .prepare("SELECT status FROM fairshare_payout_ops WHERE user_id='one'")
      .get()!.status,
    "OUTCOME_UNKNOWN",
  );
  f.db.close();
});
test("disabled payout capability stays held because no provider write was attempted", async () => {
  const f = fixture(async () => {
    throw new PayPalError("PAYOUT_NOT_CONFIGURED", 503);
  });
  await f.run();
  assert.equal(
    f.db
      .prepare("SELECT status FROM fairshare_payout_ops WHERE user_id='one'")
      .get()!.status,
    "AUTO_HELD",
  );
  f.db.close();
});
test("review, refund, adverse webhook and allocation holds prevent sending", async () => {
  for (const hold of [
    "review",
    "refund",
    "event",
    "invoice-event",
    "invoice-unknown",
    "allocation",
    "approval",
  ]) {
    let calls = 0;
    const f = fixture(async () => {
      calls++;
      return { batchId: "batch" };
    });
    if (hold === "review") f.agreement.reviewHold = true;
    if (hold === "refund")
      f.db.exec("INSERT INTO fairshare_refund_ops VALUES('refund','capture')");
    if (hold === "event")
      f.db
        .prepare("INSERT INTO fairshare_webhook_inbox VALUES(?,'PENDING')")
        .run(JSON.stringify({ kind: "HOLD_CAPTURE" }));
    if (hold === "invoice-event" || hold === "invoice-unknown")
      f.db
        .prepare("INSERT INTO fairshare_webhook_inbox VALUES(?,'PENDING')")
        .run(
          JSON.stringify({
            kind:
              hold === "invoice-event"
                ? "RECONCILE_INVOICE"
                : "RECORD_UNMATCHED",
            eventType:
              hold === "invoice-event"
                ? "INVOICING.INVOICE.REFUNDED"
                : "INVOICING.INVOICE.NEW_ADVERSE",
          }),
        );
    if (hold === "allocation")
      f.agreement.revenue[0].allocations[0].status = "HELD";
    if (hold === "approval") delete f.agreement.versions[0].approvals.one;
    await f.run();
    assert.equal(calls, 0, hold);
    f.db.close();
  }
});
test("expired lease after provider write leaves reserved unknown outcome without retry", async () => {
  let calls = 0,
    lease = true;
  const f = fixture(async () => {
    calls++;
    lease = false;
    return { batchId: "batch" };
  });
  const job = f.service.discover()[0];
  await assert.rejects(
    f.service.dispatch(job.id, () => {
      if (!lease) throw new Error("STALE_LEASE");
    }),
  );
  await f.run();
  assert.equal(calls, 1);
  assert.equal(
    f.db
      .prepare("SELECT status FROM fairshare_payout_ops WHERE user_id='one'")
      .get()!.status,
    "SUBMITTING",
  );
  f.db.close();
});
test("account-level email wins over legacy ID, is frozen as EMAIL, and UNCLAIMED is never re-sent", async () => {
  const sent: any[] = [];
  const f = fixture(async (input: any) => {
    sent.push(input);
    return { batchId: `batch-${sent.length}` };
  });
  f.db.exec(
    "INSERT INTO fairshare_payout_accounts(user_id,recipient_type,receiver,updated_at) VALUES('one','EMAIL','one@example.test',1),('two','EMAIL','two@example.test',1)",
  );
  await f.run();
  assert.deepEqual(sent.map((s) => [s.recipientType, s.recipientId]).sort(), [
    ["EMAIL", "one@example.test"],
    ["EMAIL", "two@example.test"],
  ]);
  assert.deepEqual(
    f.db
      .prepare(
        "SELECT DISTINCT recipient_type AS type FROM fairshare_payout_ops",
      )
      .all()
      .map((r: any) => r.type),
    ["EMAIL"],
  );
  f.db.exec("UPDATE fairshare_payout_ops SET status='UNCLAIMED'");
  await f.run();
  assert.equal(sent.length, 2);
  f.db.close();
});
