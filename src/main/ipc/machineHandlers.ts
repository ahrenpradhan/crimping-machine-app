import type { BrowserWindow, IpcMain } from 'electron';
import { parseLinearParams, planLinearCrimp, type DieGeometry } from '../../shared/linear';
import { parsePressureParams, samePressureParams } from '../../shared/pressure';
import { DEFAULT_PROFILE, coerceRecipes, parseProfileName, parseRecipe } from '../../shared/recipe';
import {
  IPC,
  type AppInfo,
  type CycleTag,
  type DbResult,
  type PressureCrimpParams,
  type Sample,
  type UiTick,
} from '../../shared/types';
import type { CrimpController } from '../machine/CrimpController';
import type { CycleLogger } from '../db/CycleLogger';
import type { MachineStore } from '../db/MachineStore';
import type { SensorManager } from '../sensors/SensorManager';

export interface MachineHandlerDeps {
  ipcMain: IpcMain;
  getWindow: () => BrowserWindow | null;
  controller: CrimpController;
  sensors: SensorManager;
  info: AppInfo;
  geometry: DieGeometry;
  /** null when the database could not be opened (recipes / history unavailable). */
  store: MachineStore | null;
  logger: CycleLogger | null;
}

/**
 * The ONLY place the renderer can reach machine logic (via preload's
 * `window.machine`). Handlers validate their arguments; the renderer never
 * gets Node, Modbus, or the controller itself.
 *
 * Returns a function that unregisters everything.
 */
export function registerMachineHandlers(deps: MachineHandlerDeps): () => void {
  const { ipcMain, getWindow, controller, sensors, info, geometry, store, logger } = deps;

  // ---- Request / response ------------------------------------------------
  ipcMain.handle(IPC.getSensors, () => sensors.getLatestSample());
  ipcMain.handle(IPC.getState, () => controller.getState());
  ipcMain.handle(IPC.getAppInfo, () => info);
  ipcMain.handle(IPC.getCycleData, () => ({
    cycleId: controller.getCycleId(),
    samples: controller.getCycleSamples(),
  }));

  // ---- Database helpers --------------------------------------------------
  const db = <T>(fn: (s: MachineStore) => T): DbResult<T> => {
    if (!store) return { ok: false, error: info.database.error ?? 'Database unavailable' };
    try {
      return { ok: true, data: fn(store) };
    } catch (err) {
      console.error('[DB]', err instanceof Error ? err.message : err);
      return { ok: false, error: err instanceof Error ? err.message : 'Database error' };
    }
  };

  /** Which profile / recipe a cycle belongs to (validated - the renderer is not trusted). */
  const tagFor = (rawContext: unknown, pressure: PressureCrimpParams | null): CycleTag => {
    const ctx = (typeof rawContext === 'object' && rawContext !== null ? rawContext : {}) as Record<string, unknown>;
    let profileId = DEFAULT_PROFILE.id;
    if (typeof ctx.profileId === 'string' && store) {
      try {
        if (store.getProfile(ctx.profileId)) profileId = ctx.profileId;
      } catch (err) {
        console.error('[DB] profile lookup failed:', err instanceof Error ? err.message : err);
      }
    }
    const tag: CycleTag = { profileId, recipeId: null, recipeName: null, recipeModified: false };
    if (pressure && typeof ctx.recipeId === 'string' && store) {
      try {
        const recipe = store.getRecipe(ctx.recipeId);
        if (recipe) {
          tag.recipeId = recipe.id;
          tag.recipeName = recipe.name;
          tag.recipeModified = !samePressureParams(recipe.pressure, pressure);
        }
      } catch (err) {
        console.error('[DB] recipe lookup failed:', err instanceof Error ? err.message : err);
      }
    }
    return tag;
  };

  // LINEAR: the operator works in diameters; the controller stops on stroke.
  ipcMain.handle(IPC.startLinear, (_event, raw: unknown, context: unknown) => {
    const parsed = parseLinearParams(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const { params } = parsed;
    const plan = planLinearCrimp(params, geometry);
    if (!(plan.targetStrokeMm > 0)) {
      return { ok: false, error: 'Target diameter is not smaller than the open diameter' };
    }
    return controller.startLinearCrimp(plan.targetStrokeMm, {
      holdTimeMs: Math.round(params.holdTimeSec * 1000),
      linear: params,
      tag: tagFor(context, null),
    });
  });

  // PRESSURE: stops on pressure; the die setup / slow-down point / diameter window ride along.
  ipcMain.handle(IPC.startPressure, (_event, raw: unknown, context: unknown) => {
    const parsed = parsePressureParams(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const { params } = parsed;
    return controller.startPressureCrimp(params.targetPressureBar, {
      holdTimeMs: Math.round(params.holdTimeSec * 1000),
      pressure: params,
      tag: tagFor(context, params),
    });
  });
  ipcMain.handle(IPC.stop, () => controller.stopCrimp());

  ipcMain.handle(IPC.addRejected, () => {
    logger?.markLastRejected();
    return controller.addRejected();
  });
  ipcMain.handle(IPC.resetCounters, () => controller.resetCounters());
  ipcMain.handle(IPC.teachOpen, () => controller.teachOpenPosition());

  // ---- Recipes + history (SQLite) ----------------------------------------
  ipcMain.handle(IPC.listProfiles, () => db((s) => s.listProfiles()));
  ipcMain.handle(IPC.createProfile, (_e, name: unknown) => {
    const parsed = parseProfileName(name);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return db((s) => s.createProfile(parsed.name));
  });
  ipcMain.handle(IPC.listRecipes, (_e, profileId: unknown) =>
    db((s) => s.listRecipes(typeof profileId === 'string' ? profileId : DEFAULT_PROFILE.id)),
  );
  ipcMain.handle(IPC.saveRecipe, (_e, raw: unknown) => {
    const recipe = parseRecipe(raw);
    if (!recipe) return { ok: false, error: 'Invalid recipe' };
    return db((s) => {
      if (!s.getProfile(recipe.profileId)) throw new Error('Unknown profile');
      s.saveRecipe(recipe);
      return null;
    });
  });
  ipcMain.handle(IPC.deleteRecipe, (_e, id: unknown) => {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid recipe id' };
    return db((s) => {
      s.deleteRecipe(id);
      return null;
    });
  });
  ipcMain.handle(IPC.importRecipes, (_e, raw: unknown) => {
    const valid = (coerceRecipes(raw) ?? []).flatMap((r) => {
      const ok = parseRecipe(r);
      return ok ? [ok] : [];
    });
    return db((s) => s.importRecipes(valid.filter((r) => s.getProfile(r.profileId) !== null)));
  });
  ipcMain.handle(IPC.recipeStats, (_e, profileId: unknown) =>
    db((s) => s.recipeStats(typeof profileId === 'string' ? profileId : DEFAULT_PROFILE.id)),
  );
  ipcMain.handle(IPC.listCycles, (_e, query: unknown) => {
    const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
    return db((s) =>
      s.listCycles({
        profileId: typeof q.profileId === 'string' ? q.profileId : undefined,
        recipeId: typeof q.recipeId === 'string' ? q.recipeId : undefined,
        limit: typeof q.limit === 'number' ? q.limit : undefined,
        offset: typeof q.offset === 'number' ? q.offset : undefined,
      }),
    );
  });
  ipcMain.handle(IPC.getCycleSamples, (_e, id: unknown) =>
    typeof id === 'number' && Number.isFinite(id) ? db((s) => s.getCycleSamples(id)) : { ok: false, error: 'Invalid cycle id' },
  );

  // ---- Push to the UI at 10-20 Hz (batched) ------------------------------
  // Acquisition runs at 100 Hz; the UI only ever gets ~15 batched updates/s.
  const pending: Sample[] = [];
  const onSample = (sample: Sample): void => {
    pending.push(sample);
    if (pending.length > 1000) pending.splice(0, pending.length - 1000);
  };
  sensors.on('sample', onSample);

  let sentCycleId = 0;
  let sentCount = 0;

  const pushTick = (): void => {
    const win = getWindow();
    if (!win || win.isDestroyed()) {
      pending.length = 0;
      return;
    }
    const cycleId = controller.getCycleId();
    if (cycleId !== sentCycleId) {
      sentCycleId = cycleId;
      sentCount = 0;
    }
    const cycleSamples = controller.getCycleSamplesFrom(sentCount);
    const tick: UiTick = {
      sample: sensors.getLatestSample(),
      sensorStatus: sensors.getStatus(),
      state: controller.getState(),
      samples: pending.splice(0, pending.length),
      cycle: { cycleId, fromIndex: sentCount, samples: cycleSamples },
    };
    sentCount += cycleSamples.length;
    win.webContents.send(IPC.tick, tick);
  };
  const timer = setInterval(pushTick, Math.round(1000 / info.uiRateHz));

  // State transitions are pushed immediately so short-lived states
  // (TARGET_*_REACHED) are never missed between UI ticks.
  const unsubscribeState = controller.onStateChange((state) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC.state, state);
  });

  return () => {
    clearInterval(timer);
    unsubscribeState();
    sensors.removeListener('sample', onSample);
    for (const channel of [
      IPC.getSensors,
      IPC.getState,
      IPC.getAppInfo,
      IPC.getCycleData,
      IPC.startLinear,
      IPC.startPressure,
      IPC.stop,
      IPC.addRejected,
      IPC.resetCounters,
      IPC.teachOpen,
      IPC.listProfiles,
      IPC.createProfile,
      IPC.listRecipes,
      IPC.saveRecipe,
      IPC.deleteRecipe,
      IPC.importRecipes,
      IPC.recipeStats,
      IPC.listCycles,
      IPC.getCycleSamples,
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
}
