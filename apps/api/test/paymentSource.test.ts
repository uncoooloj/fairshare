import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";

test("existing payment rows receive safe source defaults and migration is repeatable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fairshare-source-")),
    path = join(dir, "test.db");
  try {
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE fairshare_payment_ops(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,collaboration_id TEXT NOT NULL,request_key TEXT NOT NULL,version_id INTEGER NOT NULL,amount INTEGER NOT NULL,provider_order_id TEXT UNIQUE,provider_capture_id TEXT UNIQUE,status TEXT NOT NULL,approval_url TEXT,UNIQUE(workspace_id,request_key)); INSERT INTO fairshare_payment_ops(id,workspace_id,collaboration_id,request_key,version_id,amount,status) VALUES('old','workspace','agreement','key',1,100,'OUTCOME_UNKNOWN');",
    );
    db.close();
    for (let attempt = 0; attempt < 2; attempt++) {
      const app = await buildApp({ dbPath: path });
      try {
        const row = app.store.db
          .prepare("SELECT * FROM fairshare_payment_ops WHERE id=?")
          .get("old") as any;
        assert.equal(row.source_type, "PAYPAL");
        assert.equal(row.source_name, "PayPal");
        assert.equal(row.status, "OUTCOME_UNKNOWN");
        assert.equal(row.amount, 100);
        assert.equal(row.provider_capture_id, null);
      } finally {
        await app.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
