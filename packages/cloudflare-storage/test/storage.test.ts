import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  DurableSqlDatabase,
  type DurableSqlStorage,
  type SqlRow,
} from "../src/index.js";

// Contract harness only. workerd validation is separate; this does not simulate durability.
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const storage: DurableSqlStorage = {
    sql: {
      exec(query, ...bindings) {
        const statement = sqlite.prepare(query);
        const rows = statement.all(
          ...bindings.map((value) =>
            value instanceof ArrayBuffer ? new Uint8Array(value) : value,
          ),
        ) as SqlRow[];
        return {
          toArray: () => rows,
          rowsWritten: 0,
          [Symbol.iterator]: () => rows[Symbol.iterator](),
        };
      },
    },
    transactionSync(callback) {
      sqlite.exec("BEGIN");
      try {
        const value = callback();
        sqlite.exec("COMMIT");
        return value;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const db = new DurableSqlDatabase(storage);
  db.exec(
    "CREATE TABLE ledger(id TEXT PRIMARY KEY, revision INTEGER, cents INTEGER)",
  );
  return { db, close: () => sqlite.close() };
}

test("bindings, reads and direct affected-row counts preserve SQL semantics", () => {
  const { db, close } = fixture();
  try {
    assert.equal(
      db.prepare("INSERT INTO ledger VALUES(?,?,?)").run("a", 1, 100).changes,
      1,
    );
    assert.equal(
      db.prepare("UPDATE ledger SET cents=? WHERE id=?").run(200, "missing")
        .changes,
      0,
    );
    assert.equal(
      db.prepare("SELECT cents FROM ledger WHERE id=?").get("a")?.cents,
      100,
    );
    assert.equal(db.prepare("SELECT * FROM ledger").all().length, 1);
    assert.equal(
      db.prepare("SELECT * FROM ledger WHERE id=?").get("missing"),
      undefined,
    );
  } finally {
    close();
  }
});

test("duplicate capture reservation rolls back the complete financial transaction", () => {
  const { db, close } = fixture();
  try {
    db.prepare("INSERT INTO ledger VALUES(?,?,?)").run("capture-1", 1, 100);
    assert.throws(() =>
      db.tx(() => {
        db.prepare("UPDATE ledger SET cents=900 WHERE id=?").run("capture-1");
        db.prepare("INSERT INTO ledger VALUES(?,?,?)").run("capture-1", 1, 900);
      }),
    );
    assert.equal(db.prepare("SELECT cents FROM ledger").get()?.cents, 100);
  } finally {
    close();
  }
});

test("stale revision cannot overwrite committed state", () => {
  const { db, close } = fixture();
  try {
    db.prepare("INSERT INTO ledger VALUES(?,?,?)").run("a", 1, 100);
    const change = (revision: number) =>
      db.tx(() => {
        const result = db
          .prepare(
            "UPDATE ledger SET revision=revision+1,cents=? WHERE id=? AND revision=?",
          )
          .run(200, "a", revision);
        if (result.changes !== 1) throw new Error("REVISION_CONFLICT");
      });
    change(1);
    assert.throws(() => change(1), /REVISION_CONFLICT/);
    assert.equal(db.prepare("SELECT revision FROM ledger").get()?.revision, 2);
  } finally {
    close();
  }
});

test("accidental promise transaction is rejected and synchronous writes roll back", () => {
  const { db, close } = fixture();
  try {
    assert.throws(
      () =>
        db.tx(() => {
          db.prepare("INSERT INTO ledger VALUES(?,?,?)").run("a", 1, 100);
          return Promise.resolve();
        }),
      /must be synchronous/,
    );
    assert.equal(db.prepare("SELECT * FROM ledger").all().length, 0);
  } finally {
    close();
  }
});

test("binary bindings retain only the selected byte range", () => {
  const { db, close } = fixture();
  try {
    db.exec("CREATE TABLE documents(bytes BLOB)");
    db.prepare("INSERT INTO documents VALUES(?)").run(
      new Uint8Array([9, 1, 2, 9]).subarray(1, 3),
    );
    assert.equal(
      db.prepare("SELECT hex(bytes) AS value FROM documents").get()?.value,
      "0102",
    );
  } finally {
    close();
  }
});
