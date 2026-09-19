import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PROFILE,
  parseProfileName,
  type Profile,
  type Recipe,
  type RecipeOrigin,
} from '../../shared/recipe';
import type {
  CrimpMode,
  CycleLogEntry,
  CycleLogQuery,
  CycleSample,
  LinearCrimpParams,
  LoggedResult,
  PressureCrimpParams,
  ProfileSummary,
  RecipeStats,
} from '../../shared/types';
import { migrate } from './schema';
import type { SqlDb, SqlValue } from './SqlDb';

/** Everything the logger hands over for one finished cycle. */
export interface CycleLogInput extends Omit<CycleLogEntry, 'id' | 'hasSamples' | 'operatorRejected'> {
  samples: CycleSample[] | null;
}

type Row = Record<string, unknown>;

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const flag = (b: boolean | null): number | null => (b === null ? null : b ? 1 : 0);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Parses stored JSON without ever throwing (a corrupt row must not break a screen). */
function parseJson<T>(text: unknown): T | null {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * All SQL of the app in one place: profiles, recipes and the crimp-cycle
 * history. Synchronous (better-sqlite3 style) - every call is a few
 * milliseconds. Runs in the Electron main process only.
 */
export class MachineStore {
  constructor(
    private readonly db: SqlDb,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = () => randomUUID(),
  ) {
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
  }

  close(): void {
    this.db.close();
  }

  // ---- Profiles -----------------------------------------------------------

  /** Makes sure the built-in profiles exist (safe to call on every start). */
  seedProfiles(profiles: readonly Profile[]): void {
    const insert = this.db.prepare('INSERT OR IGNORE INTO profiles (id, name, created_at) VALUES (?, ?, ?)');
    for (const p of profiles) insert.run(p.id, p.name, this.now());
  }

  /** The default profile first, then in the order they were created. */
  listProfiles(): ProfileSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name,
                (SELECT COUNT(*) FROM recipes r WHERE r.profile_id = p.id AND r.deleted_at IS NULL) AS recipe_count,
                (SELECT COUNT(*) FROM crimp_cycles c WHERE c.profile_id = p.id) AS cycle_count
         FROM profiles p
         ORDER BY (p.id = ?) DESC, p.created_at, p.id`,
      )
      .all(DEFAULT_PROFILE.id) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      recipeCount: num(r.recipe_count),
      cycleCount: num(r.cycle_count),
    }));
  }

  getProfile(id: string): Profile | null {
    const row = this.db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(id) as Row | undefined;
    return row ? { id: String(row.id), name: String(row.name) } : null;
  }

  /** Creates a profile. Throws a readable Error for a bad or duplicate name. */
  createProfile(rawName: string): Profile {
    const parsed = parseProfileName(rawName);
    if (!parsed.ok) throw new Error(parsed.error);
    const taken = this.db.prepare('SELECT 1 AS x FROM profiles WHERE lower(name) = lower(?)').get(parsed.name);
    if (taken) throw new Error('A profile with this name already exists');
    const profile: Profile = { id: this.newId(), name: parsed.name };
    this.db
      .prepare('INSERT INTO profiles (id, name, created_at) VALUES (?, ?, ?)')
      .run(profile.id, profile.name, this.now());
    return profile;
  }

  // ---- Recipes ------------------------------------------------------------

  listRecipes(profileId: string): Recipe[] {
    const rows = this.db
      .prepare('SELECT * FROM recipes WHERE profile_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id')
      .all(profileId) as Row[];
    return rows.map(rowToRecipe);
  }

  getRecipe(id: string): Recipe | null {
    const row = this.db.prepare('SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined;
    return row ? rowToRecipe(row) : null;
  }

  /** Inserts or updates (by id). A previously deleted recipe with the same id is revived. */
  saveRecipe(recipe: Recipe): void {
    const p = recipe.pressure;
    this.db
      .prepare(
        `INSERT INTO recipes (
           id, profile_id, name, created_at, updated_at, deleted_at,
           target_pressure_bar, die_size_mm, open_diameter_mm, hold_time_sec,
           slow_switch_diameter_mm, slow_switch_pressure_bar, min_diameter_mm, max_diameter_mm, origin_json
         ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, updated_at = excluded.updated_at, deleted_at = NULL,
           target_pressure_bar = excluded.target_pressure_bar, die_size_mm = excluded.die_size_mm,
           open_diameter_mm = excluded.open_diameter_mm, hold_time_sec = excluded.hold_time_sec,
           slow_switch_diameter_mm = excluded.slow_switch_diameter_mm,
           slow_switch_pressure_bar = excluded.slow_switch_pressure_bar,
           min_diameter_mm = excluded.min_diameter_mm, max_diameter_mm = excluded.max_diameter_mm,
           origin_json = excluded.origin_json`,
      )
      .run(
        recipe.id,
        recipe.profileId,
        recipe.name,
        recipe.createdAt,
        this.now(),
        p.targetPressureBar,
        p.dieSizeMm,
        p.openDiameterMm,
        p.holdTimeSec,
        p.slowSwitchDiameterMm,
        p.slowSwitchPressureBar,
        p.minDiameterMm,
        p.maxDiameterMm,
        recipe.origin ? JSON.stringify(recipe.origin) : null,
      );
  }

  /** Soft delete: the recipe disappears from lists but its cycle history stays intact. */
  deleteRecipe(id: string): boolean {
    const res = this.db
      .prepare('UPDATE recipes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(this.now(), this.now(), id);
    return Number(res.changes) > 0;
  }

  /** One-time import (recipes created before the database existed). Existing ids are left alone. */
  importRecipes(recipes: Recipe[]): number {
    const exists = this.db.prepare('SELECT 1 AS x FROM recipes WHERE id = ?');
    let imported = 0;
    this.transaction(() => {
      for (const r of recipes) {
        if (exists.get(r.id)) continue;
        this.saveRecipe(r);
        imported++;
      }
    });
    return imported;
  }

  // ---- Cycle history ------------------------------------------------------

  /** Stores one finished cycle (and its curve). Returns the new row id. */
  logCycle(c: CycleLogInput): number {
    let id = 0;
    this.transaction(() => {
      const res = this.db
        .prepare(
          `INSERT INTO crimp_cycles (
             profile_id, recipe_id, recipe_name, recipe_modified, session_id, cycle_number, mode, result,
             started_at, finished_at, duration_ms, target, hold_time_ms,
             final_pressure_bar, final_displacement_mm, final_diameter_mm, peak_pressure_bar,
             at_target_pressure_bar, at_target_displacement_mm, at_target_diameter_mm,
             slow_engaged, within_tolerance, fault_message, params_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          c.profileId,
          c.recipeId,
          c.recipeName,
          c.recipeModified ? 1 : 0,
          c.sessionId,
          c.cycleNumber,
          c.mode,
          c.result,
          Math.round(c.startedAt),
          Math.round(c.finishedAt),
          Math.round(c.durationMs),
          c.target,
          Math.round(c.holdTimeMs),
          c.finalPressureBar,
          c.finalDisplacementMm,
          c.finalDiameterMm,
          c.peakPressureBar,
          c.atTargetPressureBar,
          c.atTargetDisplacementMm,
          c.atTargetDiameterMm,
          c.slowEngaged ? 1 : 0,
          flag(c.withinTolerance),
          c.faultMessage,
          c.params ? JSON.stringify(c.params) : null,
        );
      id = Number(res.lastInsertRowid);

      if (c.samples && c.samples.length > 0) {
        const compact = c.samples.map((s) => [Math.round(s.timestamp), r3(s.pressureBar), r3(s.displacementMm)]);
        this.db
          .prepare('INSERT INTO cycle_samples (cycle_id, sample_count, data) VALUES (?, ?, ?)')
          .run(id, compact.length, JSON.stringify(compact));
      }
    });
    return id;
  }

  /** The operator marked the piece of this cycle as bad. */
  markCycleRejected(cycleLogId: number): void {
    this.db.prepare('UPDATE crimp_cycles SET operator_rejected = operator_rejected + 1 WHERE id = ?').run(cycleLogId);
  }

  /** Newest first. */
  listCycles(query: CycleLogQuery = {}): CycleLogEntry[] {
    const where: string[] = [];
    const args: SqlValue[] = [];
    if (query.profileId) {
      where.push('c.profile_id = ?');
      args.push(query.profileId);
    }
    if (query.recipeId) {
      where.push('c.recipe_id = ?');
      args.push(query.recipeId);
    }
    const limit = Math.min(1000, Math.max(1, Math.floor(query.limit ?? 100)));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const sql = `
      SELECT c.*, (s.cycle_id IS NOT NULL) AS has_samples
      FROM crimp_cycles c LEFT JOIN cycle_samples s ON s.cycle_id = c.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.finished_at DESC, c.id DESC
      LIMIT ? OFFSET ?`;
    return (this.db.prepare(sql).all(...args, limit, offset) as Row[]).map(rowToCycle);
  }

  getCycleSamples(cycleLogId: number): CycleSample[] {
    const row = this.db.prepare('SELECT data FROM cycle_samples WHERE cycle_id = ?').get(cycleLogId) as Row | undefined;
    const raw = parseJson<number[][]>(row?.data);
    if (!raw) return [];
    return raw.map(([t, p, d]) => ({ timestamp: t, pressureBar: p, displacementMm: d }));
  }

  /** Cycles / good / bad / last run per recipe. Good = completed and in tolerance and not rejected. */
  recipeStats(profileId: string): Record<string, RecipeStats> {
    const rows = this.db
      .prepare(
        `SELECT recipe_id,
                COUNT(*) AS cycles,
                SUM(CASE WHEN result = 'COMPLETE' AND within_tolerance IS NOT 0 AND operator_rejected = 0 THEN 1 ELSE 0 END) AS good,
                SUM(CASE WHEN result = 'COMPLETE' AND (within_tolerance = 0 OR operator_rejected > 0) THEN 1 ELSE 0 END) AS bad,
                MAX(finished_at) AS last_run
         FROM crimp_cycles
         WHERE profile_id = ? AND recipe_id IS NOT NULL
         GROUP BY recipe_id`,
      )
      .all(profileId) as Row[];
    const out: Record<string, RecipeStats> = {};
    for (const r of rows) {
      out[String(r.recipe_id)] = {
        cycles: num(r.cycles),
        good: num(r.good),
        bad: num(r.bad),
        lastRunAt: numOrNull(r.last_run),
      };
    }
    return out;
  }

  // ---- Internals ----------------------------------------------------------

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

function rowToRecipe(r: Row): Recipe {
  const pressure: PressureCrimpParams = {
    targetPressureBar: num(r.target_pressure_bar),
    dieSizeMm: num(r.die_size_mm),
    openDiameterMm: num(r.open_diameter_mm),
    holdTimeSec: num(r.hold_time_sec),
    slowSwitchDiameterMm: num(r.slow_switch_diameter_mm),
    slowSwitchPressureBar: num(r.slow_switch_pressure_bar),
    minDiameterMm: num(r.min_diameter_mm),
    maxDiameterMm: num(r.max_diameter_mm),
  };
  return {
    id: String(r.id),
    name: String(r.name),
    profileId: String(r.profile_id ?? DEFAULT_PROFILE.id),
    createdAt: num(r.created_at),
    pressure,
    origin: parseJson<RecipeOrigin>(r.origin_json),
  };
}

function rowToCycle(r: Row): CycleLogEntry {
  return {
    id: num(r.id),
    profileId: String(r.profile_id),
    recipeId: r.recipe_id === null ? null : String(r.recipe_id),
    recipeName: r.recipe_name === null ? null : String(r.recipe_name),
    recipeModified: num(r.recipe_modified) === 1,
    sessionId: String(r.session_id),
    cycleNumber: num(r.cycle_number),
    mode: String(r.mode) as CrimpMode,
    result: String(r.result) as LoggedResult,
    startedAt: num(r.started_at),
    finishedAt: num(r.finished_at),
    durationMs: num(r.duration_ms),
    target: num(r.target),
    holdTimeMs: num(r.hold_time_ms),
    finalPressureBar: num(r.final_pressure_bar),
    finalDisplacementMm: num(r.final_displacement_mm),
    finalDiameterMm: numOrNull(r.final_diameter_mm),
    peakPressureBar: num(r.peak_pressure_bar),
    atTargetPressureBar: numOrNull(r.at_target_pressure_bar),
    atTargetDisplacementMm: numOrNull(r.at_target_displacement_mm),
    atTargetDiameterMm: numOrNull(r.at_target_diameter_mm),
    slowEngaged: num(r.slow_engaged) === 1,
    withinTolerance: r.within_tolerance === null ? null : num(r.within_tolerance) === 1,
    operatorRejected: num(r.operator_rejected),
    faultMessage: r.fault_message === null ? null : String(r.fault_message),
    params: parseJson<LinearCrimpParams | PressureCrimpParams>(r.params_json),
    hasSamples: num(r.has_samples) === 1,
  };
}
