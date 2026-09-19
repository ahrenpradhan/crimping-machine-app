import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SqlDb, SqlStatement, SqlValue } from './SqlDb';

/**
 * Opens the app's SQLite file with better-sqlite3 (a native module - it is
 * rebuilt for Electron by the `postinstall` script). Loaded lazily so a
 * problem with the native module shows up as a database error in the UI
 * instead of stopping the whole app from starting.
 */
export async function openDatabase(filePath: string): Promise<SqlDb> {
  mkdirSync(dirname(filePath), { recursive: true });
  const mod = await import('better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Database = ((mod as any).default ?? mod) as new (path: string) => any;
  const raw = new Database(filePath);
  // WAL: readers never block the writer, and a power cut cannot corrupt the file.
  raw.pragma('journal_mode = WAL');
  raw.pragma('synchronous = NORMAL');

  return {
    exec: (sql: string): void => {
      raw.exec(sql);
    },
    prepare: (sql: string): SqlStatement => {
      const st = raw.prepare(sql);
      return {
        run: (...p: SqlValue[]) => st.run(...p),
        get: (...p: SqlValue[]) => st.get(...p),
        all: (...p: SqlValue[]) => st.all(...p),
      };
    },
    close: (): void => {
      raw.close();
    },
  };
}
