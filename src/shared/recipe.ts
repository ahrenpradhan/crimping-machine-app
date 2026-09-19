import { PRESSURE_PARAM_LIMITS, coercePressureParams, parsePressureParams } from './pressure';
import type { CycleSummary, LinearCrimpParams, PressureCrimpParams } from './types';

/**
 * Recipes and profiles.
 *
 * A recipe is a stored set of CRIMP BY PRESSURE parameters for production. The
 * usual way to make one: set a part up with CRIMP BY LINEAR (which controls the
 * die diameter directly), then save the pressure that crimp needed as a recipe.
 * Production then runs in pressure mode with that recipe.
 */

export interface Profile {
  id: string;
  name: string;
}

/** The profile every installation starts with (it cannot be removed). */
export const DEFAULT_PROFILE: Profile = { id: 'default', name: 'Default profile' };
/** Profiles created in the database on first start. */
export const SEED_PROFILES: readonly Profile[] = [DEFAULT_PROFILE];

export const MAX_PROFILE_NAME_LENGTH = 30;

export type ParsedProfileName = { ok: true; name: string } | { ok: false; error: string };

/** Validates a profile name typed by the operator (also used by the main process). */
export function parseProfileName(raw: unknown): ParsedProfileName {
  if (typeof raw !== 'string') return { ok: false, error: 'Enter a profile name' };
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (name === '') return { ok: false, error: 'Enter a profile name' };
  if (name.length > MAX_PROFILE_NAME_LENGTH) {
    return { ok: false, error: `Profile name can be at most ${MAX_PROFILE_NAME_LENGTH} characters` };
  }
  return { ok: true, name };
}

/** Where a recipe's numbers came from (only for recipes made from a linear crimp). */
export interface RecipeOrigin {
  cycleId: number;
  /** The linear parameters of the crimp it was learned from. */
  linear: LinearCrimpParams;
  /** Die diameter reached (mm) and pressure needed (bar) at the target. */
  diameterMm: number;
  pressureBar: number;
  /** +/- window around the diameter that was accepted (mm). */
  toleranceMm: number;
}

export interface Recipe {
  id: string;
  name: string;
  profileId: string;
  createdAt: number;
  /** The parameters production (CRIMP BY PRESSURE) runs with. */
  pressure: PressureCrimpParams;
  origin: RecipeOrigin | null;
}

export const DEFAULT_RECIPE_TOLERANCE_MM = 0.5;
export const RECIPE_TOLERANCE_LIMITS = { min: 0.05, max: 5 } as const;
export const MAX_RECIPE_NAME_LENGTH = 40;

const round = (v: number, decimals: number): number => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Can this cycle be turned into a recipe? Returns the reason when it cannot. */
export function recipeBlocker(cycle: CycleSummary | null): string | null {
  if (!cycle) return 'Run a crimp first';
  if (cycle.mode !== 'LINEAR') return 'Recipes are made from a CRIMP BY LINEAR cycle';
  if (cycle.result !== 'COMPLETE') return 'The last crimp did not complete';
  if (!cycle.linear || !cycle.atTarget || cycle.atTarget.diameterMm === null) {
    return 'The last crimp has no diameter reading';
  }
  return null;
}

export function defaultRecipeName(cycle: CycleSummary, now: Date = new Date()): string {
  const dia = cycle.atTarget?.diameterMm ?? cycle.linear?.targetDiameterMm ?? 0;
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `Ø${dia.toFixed(1)} - ${hh}:${mm}`;
}

export type PlannedRecipe = { ok: true; recipe: Recipe } | { ok: false; error: string };

/**
 * Turns a completed linear crimp into a pressure-mode recipe:
 *   target pressure  = the pressure the crimp needed to reach that diameter
 *   accepted Ø       = the diameter reached +/- tolerance
 *   slow-down point  = 6 mm above the diameter (as on the Uniflex default) and
 *                      20 % of the target pressure, whichever comes first
 *   die / open Ø / hold time = copied from the linear job
 */
export function planRecipeFromLinearCycle(
  cycle: CycleSummary | null,
  opts: { name: string; toleranceMm: number; profileId: string; id: string; now: number },
): PlannedRecipe {
  const blocker = recipeBlocker(cycle);
  if (blocker || !cycle || !cycle.linear || !cycle.atTarget || cycle.atTarget.diameterMm === null) {
    return { ok: false, error: blocker ?? 'Cannot create a recipe from this cycle' };
  }
  const name = opts.name.trim().slice(0, MAX_RECIPE_NAME_LENGTH);
  if (name === '') return { ok: false, error: 'Give the recipe a name' };
  if (
    !Number.isFinite(opts.toleranceMm) ||
    opts.toleranceMm < RECIPE_TOLERANCE_LIMITS.min ||
    opts.toleranceMm > RECIPE_TOLERANCE_LIMITS.max
  ) {
    return {
      ok: false,
      error: `Tolerance must be between ${RECIPE_TOLERANCE_LIMITS.min} and ${RECIPE_TOLERANCE_LIMITS.max} mm`,
    };
  }

  const dia = cycle.atTarget.diameterMm;
  const pressureBar = cycle.atTarget.pressureBar;
  const target = round(clamp(pressureBar, 1, PRESSURE_PARAM_LIMITS.targetPressureBar.max), 1);

  const pressure: PressureCrimpParams = {
    targetPressureBar: target,
    dieSizeMm: cycle.linear.dieSizeMm,
    openDiameterMm: cycle.linear.openDiameterMm,
    holdTimeSec: cycle.linear.holdTimeSec,
    slowSwitchDiameterMm: round(clamp(dia + 6, 5, 200), 1),
    slowSwitchPressureBar: clamp(Math.round(target * 0.2), 1, 600),
    minDiameterMm: round(clamp(dia - opts.toleranceMm, 5, 200), 2),
    maxDiameterMm: round(clamp(dia + opts.toleranceMm, 5, 200), 2),
  };
  const parsed = parsePressureParams(pressure);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  return {
    ok: true,
    recipe: {
      id: opts.id,
      name,
      profileId: opts.profileId,
      createdAt: opts.now,
      pressure: parsed.params,
      origin: {
        cycleId: cycle.cycleId,
        linear: { ...cycle.linear },
        diameterMm: round(dia, 2),
        pressureBar: round(pressureBar, 1),
        toleranceMm: opts.toleranceMm,
      },
    },
  };
}

// ---- Stored data --------------------------------------------------------

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function coerceOrigin(raw: unknown): RecipeOrigin | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const lin = o.linear as Record<string, unknown> | null;
  if (!num(o.cycleId) || !num(o.diameterMm) || !num(o.pressureBar) || !num(o.toleranceMm)) {
    return null;
  }
  if (typeof lin !== 'object' || lin === null) return null;
  const keys = ['targetDiameterMm', 'correctionMm', 'dieSizeMm', 'openDiameterMm', 'holdTimeSec'];
  if (!keys.every((k) => num(lin[k]))) return null;
  return {
    cycleId: o.cycleId,
    diameterMm: o.diameterMm,
    pressureBar: o.pressureBar,
    toleranceMm: o.toleranceMm,
    linear: lin as unknown as LinearCrimpParams,
  };
}

/** Lenient loader for the stored recipe list: drops anything malformed. */
export function coerceRecipes(raw: unknown): Recipe[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Recipe[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const pressure = coercePressureParams(r.pressure);
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || !pressure) continue;
    out.push({
      id: r.id,
      name: r.name.slice(0, MAX_RECIPE_NAME_LENGTH),
      profileId: typeof r.profileId === 'string' ? r.profileId : DEFAULT_PROFILE.id,
      createdAt: num(r.createdAt) ? r.createdAt : 0,
      pressure,
      origin: coerceOrigin(r.origin),
    });
  }
  return out;
}

/** Validates ONE recipe coming from an untrusted source (IPC). Null when it is not usable. */
export function parseRecipe(raw: unknown): Recipe | null {
  const list = coerceRecipes([raw]);
  const recipe = list?.[0];
  if (!recipe || recipe.name.trim() === '') return null;
  if (!parsePressureParams(recipe.pressure).ok) return null;
  return { ...recipe, name: recipe.name.trim() };
}

/** Stored / received profile id: any non-empty string (whether it exists is checked against the database). */
export const asProfileId = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null;
