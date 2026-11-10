import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createReconciliationWorker } from "../src/reconciliationWorker.js";
const job = { kind: "PAYMENT", id: "one" };
test("deterministic durable backoff survives worker restart, terminal jobs stop", async () => {
  const db = new DatabaseSync(":memory:");
  let time = 10_000,
    calls = 0,
    eligible = true;
  const options = {
    db,
    clock: () => time,
    intervalMs: 1000,
    discover: () => (eligible ? [job] : []),
    reconcile: async () => {
      calls++;
      throw new Error("secret provider payload");
    },
  };
  const a = createReconciliationWorker(options);
  await a.tick();
  assert.equal(calls, 1);
  await a.stop();
  const row = db
    .prepare("SELECT * FROM fairshare_reconciliation_jobs")
    .get() as any;
  assert.equal(row.next_run, 12000);
  assert.equal(row.last_result, "RETRY_REQUIRED");
  assert.equal(JSON.stringify(row).includes("secret"), false);
  const b = createReconciliationWorker(options);
  await b.tick();
  assert.equal(calls, 1);
  time = 12000;
  await b.tick();
  assert.equal(calls, 2);
  eligible = false;
  time = 16000;
  await b.tick();
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM fairshare_reconciliation_jobs").get()!
      .n,
    0,
  );
  await b.stop();
  db.close();
});
test("two workers cannot own same job; expired lease fences stale result", async () => {
  const db = new DatabaseSync(":memory:");
  let time = 10000,
    release!: () => void,
    writes = 0;
  const opts = {
    db,
    clock: () => time,
    intervalMs: 1000,
    leaseMs: 1000,
    discover: () => [job],
  };
  const a = createReconciliationWorker({
    ...opts,
    reconcile: async (_j, check) => {
      await new Promise<void>((r) => (release = r));
      check();
      writes++;
    },
  });
  const b = createReconciliationWorker({
    ...opts,
    reconcile: async (_j, check) => {
      check();
      writes++;
    },
  });
  const pending = a.tick();
  await b.tick();
  assert.equal(writes, 0);
  time = 11001;
  await b.tick();
  assert.equal(writes, 1);
  release();
  await pending;
  assert.equal(writes, 1);
  await a.stop();
  await b.stop();
  db.close();
});
test("local ticks coalesce and stop fences pending writes before database close", async () => {
  const db = new DatabaseSync(":memory:");
  let release!: () => void,
    calls = 0,
    writes = 0;
  const w = createReconciliationWorker({
    db,
    discover: () => [job],
    reconcile: async (_j, check) => {
      calls++;
      await new Promise<void>((r) => (release = r));
      check();
      writes++;
    },
  });
  const a = w.tick(),
    b = w.tick();
  assert.equal(a, b);
  assert.equal(calls, 1);
  const stopping = w.stop();
  release();
  await Promise.all([a, stopping]);
  assert.equal(writes, 0);
  db.close();
});
