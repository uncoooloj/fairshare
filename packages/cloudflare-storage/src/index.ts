/** Minimal structural types: no dependency on Node SQLite or Worker globals. */
export type SqlValue = string | number | null | ArrayBuffer;
export type SqlInput = SqlValue | ArrayBufferView;
export type SqlRow = Record<string, SqlValue>;
export interface SqlCursor extends Iterable<SqlRow> {
  toArray(): SqlRow[];
  readonly rowsWritten: number;
}
export interface DurableSqlStorage {
  readonly sql: { exec(query: string, ...bindings: SqlValue[]): SqlCursor };
  transactionSync<T>(callback: () => T): T;
}

/**
 * SQL execution seam for a SQLite-backed Durable Object, not a remote D1 shim.
 * Construct and use inside one DO; never expose arbitrary SQL over HTTP/RPC.
 */
export class DurableSqlDatabase {
  private readonly storage: DurableSqlStorage;

  constructor(storage: DurableSqlStorage) {
    this.storage = storage;
  }

  exec(query: string): void {
    this.storage.sql.exec(query);
  }

  prepare(query: string) {
    const execute = (bindings: SqlInput[]) => this.storage.sql.exec(query, ...bindings.map(value =>
      ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer
        : value,
    ));
    return {
      get: (...bindings: SqlInput[]) => execute(bindings).toArray()[0],
      all: (...bindings: SqlInput[]) => execute(bindings).toArray(),
      run: (...bindings: SqlInput[]) => {
        const cursor = execute(bindings);
        // Materialize the cursor before querying connection-local change count.
        cursor.toArray();
        const row = this.storage.sql.exec('SELECT changes() AS changes').toArray()[0];
        return { changes: Number(row?.changes ?? 0) };
      },
    };
  }

  /** Provider/network work must occur outside this synchronous atomic boundary. */
  tx<T>(callback: () => T): T {
    return this.storage.transactionSync(() => {
      const result = callback();
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new Error('Durable SQL transaction callbacks must be synchronous');
      }
      return result;
    });
  }
}
