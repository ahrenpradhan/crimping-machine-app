import type { SqlDb } from './SqlDb';

/**
 * Schema migrations. `PRAGMA user_version` holds the number of migrations that
 * have been applied; each entry below runs once, in order, inside a transaction.
 * NEVER edit an entry that has shipped - append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  // ---- v1: profiles, recipes, cycle history ---------------------------------
  `
  CREATE TABLE profiles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE recipes (
    id                        TEXT PRIMARY KEY,
    profile_id                TEXT NOT NULL REFERENCES profiles(id),
    name                      TEXT NOT NULL,
    created_at                INTEGER NOT NULL,
    updated_at                INTEGER NOT NULL,
    deleted_at                INTEGER,               -- soft delete: history keeps pointing at it
    target_pressure_bar       REAL NOT NULL,
    die_size_mm               REAL NOT NULL,
    open_diameter_mm          REAL NOT NULL,
    hold_time_sec             REAL NOT NULL,
    slow_switch_diameter_mm   REAL NOT NULL,
    slow_switch_pressure_bar  REAL NOT NULL,
    min_diameter_mm           REAL NOT NULL,
    max_diameter_mm           REAL NOT NULL,
    origin_json               TEXT                   -- what the recipe was learned from (or NULL)
  );
  CREATE INDEX idx_recipes_profile ON recipes(profile_id, deleted_at);

  CREATE TABLE crimp_cycles (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id                TEXT NOT NULL REFERENCES profiles(id),
    recipe_id                 TEXT REFERENCES recipes(id),
    recipe_name               TEXT,                  -- snapshot at the time of the cycle
    recipe_modified           INTEGER NOT NULL DEFAULT 0,
    session_id                TEXT NOT NULL,         -- app start time; with cycle_number identifies the run
    cycle_number              INTEGER NOT NULL,
    mode                      TEXT NOT NULL CHECK (mode IN ('LINEAR','PRESSURE')),
    result                    TEXT NOT NULL CHECK (result IN ('COMPLETE','STOPPED','FAULT')),
    started_at                INTEGER NOT NULL,      -- ms since epoch
    finished_at               INTEGER NOT NULL,
    duration_ms               INTEGER NOT NULL,
    target                    REAL NOT NULL,         -- stroke mm (LINEAR) or bar (PRESSURE)
    hold_time_ms              INTEGER NOT NULL,
    final_pressure_bar        REAL NOT NULL,
    final_displacement_mm     REAL NOT NULL,
    final_diameter_mm         REAL,
    peak_pressure_bar         REAL NOT NULL,
    at_target_pressure_bar    REAL,
    at_target_displacement_mm REAL,
    at_target_diameter_mm     REAL,
    slow_engaged              INTEGER NOT NULL DEFAULT 0,
    within_tolerance          INTEGER,               -- NULL = not checked, 0 = out, 1 = in
    operator_rejected         INTEGER NOT NULL DEFAULT 0,
    fault_message             TEXT,
    params_json               TEXT
  );
  CREATE INDEX idx_cycles_recipe  ON crimp_cycles(recipe_id, finished_at DESC);
  CREATE INDEX idx_cycles_profile ON crimp_cycles(profile_id, finished_at DESC);

  -- The recorded curve of each cycle, kept apart so listing cycles stays light.
  -- data = JSON [[t_ms, pressure_bar, displacement_mm], ...]
  CREATE TABLE cycle_samples (
    cycle_id      INTEGER PRIMARY KEY REFERENCES crimp_cycles(id) ON DELETE CASCADE,
    sample_count  INTEGER NOT NULL,
    data          TEXT NOT NULL
  );
  `,
];

/** Brings a database up to the latest schema. Throws if the file is from a newer app. */
export function migrate(db: SqlDb): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Database schema v${current} is newer than this app understands (v${MIGRATIONS.length})`,
    );
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
