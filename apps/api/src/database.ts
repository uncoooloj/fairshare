/** Synchronous SQL boundary shared by local SQLite and Durable Object SQL. */
export interface Database {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...bindings: any[]): any;
    all(...bindings: any[]): any[];
    run(...bindings: any[]): { changes: number | bigint };
  };
}
export interface DatabaseBackend {
  db: Database;
  tx<T>(callback: () => T): T;
  close(): void;
}
