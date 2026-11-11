import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";

export interface ReconciliationJob {
  kind: string;
  id: string;
}
export interface ReconciliationWorkerOptions {
  db: Database;
  discover: () => ReconciliationJob[];
  reconcile: (job: ReconciliationJob, assertLease: () => void) => Promise<void>;
  clock?: () => number;
  intervalMs?: number;
  leaseMs?: number;
  batchSize?: number;
}
/** Durable deterministic backoff and per-job fenced leases.
 * The reconcile callback MUST call assertLease immediately before every local write
 * after an await. Money-writing jobs must durably reserve unique operations before
 * provider I/O and must never retry uncertain submissions. */
export function createReconciliationWorker(
  options: ReconciliationWorkerOptions,
) {
  const { db } = options,
    clock = options.clock ?? Date.now;
  const interval = options.intervalMs ?? 30_000,
    lease = options.leaseMs ?? 120_000,
    batch = options.batchSize ?? 20;
  if (
    !Number.isSafeInteger(interval) ||
    interval < 1000 ||
    !Number.isSafeInteger(lease) ||
    lease < 1000 ||
    !Number.isSafeInteger(batch) ||
    batch < 1 ||
    batch > 100
  )
    throw new Error("Invalid reconciliation worker bounds");
  db.exec(
    `CREATE TABLE IF NOT EXISTS fairshare_reconciliation_jobs(kind TEXT NOT NULL,id TEXT NOT NULL,next_run INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,last_result TEXT,PRIMARY KEY(kind,id));`,
  );
  let timer: ReturnType<typeof setTimeout> | undefined,
    stopped = false,
    inFlight: Promise<void> | undefined;
  async function run() {
    for (const job of options.discover())
      db.prepare(
        "INSERT OR IGNORE INTO fairshare_reconciliation_jobs(kind,id,next_run) VALUES(?,?,?)",
      ).run(job.kind, job.id, clock());
    const rows = db
      .prepare(
        "SELECT kind,id FROM fairshare_reconciliation_jobs WHERE next_run<=? AND lease_until<=? ORDER BY next_run,kind,id LIMIT ?",
      )
      .all(clock(), clock(), batch) as unknown as ReconciliationJob[];
    // Eligibility is refreshed each tick; terminal or unknown-ID operations are not polled.
    const eligible = new Set(
      options.discover().map((j) => JSON.stringify([j.kind, j.id])),
    );
    for (const job of rows) {
      if (stopped) break;
      if (!eligible.has(JSON.stringify([job.kind, job.id]))) {
        db.prepare(
          "DELETE FROM fairshare_reconciliation_jobs WHERE kind=? AND id=? AND lease_until<=?",
        ).run(job.kind, job.id, clock());
        continue;
      }
      const token = randomUUID(),
        time = clock();
      const claimed = db
        .prepare(
          "UPDATE fairshare_reconciliation_jobs SET lease_token=?,lease_until=? WHERE kind=? AND id=? AND lease_until<=? AND next_run<=?",
        )
        .run(token, time + lease, job.kind, job.id, time, time);
      if (!claimed.changes) continue;
      const assertLease = () => {
        const row = db
          .prepare(
            "SELECT lease_token,lease_until FROM fairshare_reconciliation_jobs WHERE kind=? AND id=?",
          )
          .get(job.kind, job.id) as any;
        if (
          stopped ||
          !row ||
          row.lease_token !== token ||
          row.lease_until <= clock()
        )
          throw new Error("RECONCILIATION_LEASE_LOST");
      };
      // Long network reads renew a lease; a suspended/stale process is fenced at write time.
      const heartbeat = setInterval(
        () => {
          if (!stopped)
            db.prepare(
              "UPDATE fairshare_reconciliation_jobs SET lease_until=? WHERE kind=? AND id=? AND lease_token=? AND lease_until>?",
            ).run(clock() + lease, job.kind, job.id, token, clock());
        },
        Math.max(250, Math.floor(lease / 3)),
      );
      heartbeat.unref?.();
      let ok = false;
      try {
        await options.reconcile(job, assertLease);
        assertLease();
        ok = true;
      } catch {
        /* Persist only a safe outcome code, never provider payload or credentials. */
      } finally {
        clearInterval(heartbeat);
        const row = db
          .prepare(
            "SELECT attempts FROM fairshare_reconciliation_jobs WHERE kind=? AND id=? AND lease_token=?",
          )
          .get(job.kind, job.id, token) as any;
        if (row) {
          const attempts = ok ? 0 : Math.min(row.attempts + 1, 20),
            delay = ok
              ? interval
              : Math.min(interval * 2 ** Math.min(attempts, 10), 3_600_000);
          db.prepare(
            "UPDATE fairshare_reconciliation_jobs SET next_run=?,attempts=?,lease_token=NULL,lease_until=0,last_result=? WHERE kind=? AND id=? AND lease_token=?",
          ).run(
            clock() + delay,
            attempts,
            ok ? "CHECKED" : "RETRY_REQUIRED",
            job.kind,
            job.id,
            token,
          );
        }
      }
    }
  }
  const tick = () => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = run().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
  const schedule = () => {
    timer = setTimeout(() => {
      void tick()
        .catch(() => {})
        .finally(() => {
          if (!stopped) schedule();
        });
    }, interval);
    timer.unref?.();
  };
  return {
    tick,
    start() {
      if (stopped) throw new Error("Worker stopped");
      if (!timer) schedule();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
    },
  };
}
