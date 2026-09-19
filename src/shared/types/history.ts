import type { CrimpMode, LinearCrimpParams, PressureCrimpParams } from './machine';

/** Who/what a cycle belongs to. Set when the cycle is started from the UI. */
export interface CycleTag {
  profileId: string;
  /** The recipe that was loaded in pressure mode, if any. */
  recipeId: string | null;
  /** Name at the time of the cycle (kept even if the recipe is renamed/deleted later). */
  recipeName: string | null;
  /** The parameters differed from the stored recipe (operator edited a value). */
  recipeModified: boolean;
}

/** Passed by the UI with START so the cycle can be filed under a profile / recipe. */
export interface StartContext {
  profileId: string;
  recipeId: string | null;
}

/** A profile with what is stored under it (for the profile screen). */
export interface ProfileSummary {
  id: string;
  name: string;
  recipeCount: number;
  cycleCount: number;
}

export type LoggedResult = 'COMPLETE' | 'STOPPED' | 'FAULT';

/** One row of the crimp-cycle history (table `crimp_cycles`). */
export interface CycleLogEntry {
  id: number;
  profileId: string;
  recipeId: string | null;
  recipeName: string | null;
  recipeModified: boolean;
  /** App start time (ms since epoch, as text) - with `cycleNumber` it identifies the cycle in that run. */
  sessionId: string;
  cycleNumber: number;
  mode: CrimpMode;
  result: LoggedResult;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  /** Controlled quantity: stroke (mm) for LINEAR, bar for PRESSURE. */
  target: number;
  holdTimeMs: number;
  finalPressureBar: number;
  finalDisplacementMm: number;
  finalDiameterMm: number | null;
  peakPressureBar: number;
  atTargetPressureBar: number | null;
  atTargetDisplacementMm: number | null;
  atTargetDiameterMm: number | null;
  slowEngaged: boolean;
  /** PRESSURE: final diameter inside the accepted window? null = not checked. */
  withinTolerance: boolean | null;
  /** How many times the operator pressed "+" (bad piece) right after this cycle. */
  operatorRejected: number;
  faultMessage: string | null;
  /** The parameters the cycle ran with. */
  params: LinearCrimpParams | PressureCrimpParams | null;
  hasSamples: boolean;
}

export interface CycleLogQuery {
  profileId?: string;
  recipeId?: string;
  /** Default 100, max 1000. */
  limit?: number;
  offset?: number;
}

/** Production numbers of one recipe, from the history. */
export interface RecipeStats {
  cycles: number;
  good: number;
  bad: number;
  lastRunAt: number | null;
}

export interface DatabaseStatus {
  ok: boolean;
  path: string;
  error: string | null;
}
