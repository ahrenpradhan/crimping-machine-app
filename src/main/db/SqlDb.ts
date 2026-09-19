/**
 * The tiny slice of a synchronous SQLite driver that the app uses.
 *
 * Production uses better-sqlite3 (see openDatabase.ts). The headless verify
 * script uses Node's built-in `node:sqlite`. Both expose exec/prepare/run/get/all,
 * so MachineStore is written against this interface only. Positional `?`
 * parameters only - that is the common subset of both drivers.
 */
export type SqlValue = string | number | bigint | null;

export interface SqlRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface SqlStatement {
  run(...params: SqlValue[]): SqlRunResult;
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}

export interface SqlDb {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}
