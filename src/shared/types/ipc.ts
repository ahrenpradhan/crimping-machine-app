import type { DieGeometry } from '../linear';
import type { Profile, Recipe } from '../recipe';
import type {
  CommandResult,
  CycleSample,
  LinearCrimpParams,
  MachineState,
  PressureCrimpParams,
} from './machine';
import type {
  CycleLogEntry,
  CycleLogQuery,
  DatabaseStatus,
  ProfileSummary,
  RecipeStats,
  StartContext,
} from './history';
import type { Sample, SensorStatus } from './sensors';

/** Every IPC channel in one place. */
export const IPC = {
  getSensors: 'machine:getSensors',
  getState: 'machine:getState',
  getCycleData: 'machine:getCycleData',
  getAppInfo: 'machine:getAppInfo',
  startLinear: 'machine:startLinearCrimp',
  startPressure: 'machine:startPressureCrimp',
  stop: 'machine:stopCrimp',
  addRejected: 'machine:addRejected',
  resetCounters: 'machine:resetCounters',
  teachOpen: 'machine:teachOpenPosition',
  listProfiles: 'db:listProfiles',
  createProfile: 'db:createProfile',
  listRecipes: 'db:listRecipes',
  saveRecipe: 'db:saveRecipe',
  deleteRecipe: 'db:deleteRecipe',
  importRecipes: 'db:importRecipes',
  recipeStats: 'db:recipeStats',
  listCycles: 'db:listCycles',
  getCycleSamples: 'db:getCycleSamples',
  /** main -> renderer, ~15 Hz */
  tick: 'machine:tick',
  /** main -> renderer, immediately on every state transition */
  state: 'machine:state',
} as const;

export interface AppInfo {
  simulation: boolean;
  sampleRateHz: number;
  uiRateHz: number;
  geometry: DieGeometry;
  database: DatabaseStatus;
  limits: {
    maxTargetDisplacementMm: number;
    maxTargetPressureBar: number;
  };
}

/** Result of a database call. Errors are reported, never thrown across IPC. */
export type DbResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface CycleData {
  cycleId: number;
  samples: CycleSample[];
}

/** Batched update pushed from the main process at the UI rate (10-20 Hz). */
export interface UiTick {
  /** Most recent reading (null until the first sample arrives). */
  sample: Sample | null;
  sensorStatus: SensorStatus;
  state: MachineState;
  /** Every sample acquired since the previous tick (for the live rolling window). */
  samples: Sample[];
  /** New cycle samples since the previous tick. */
  cycle: {
    cycleId: number;
    /** Index of samples[0] within the cycle; lets the renderer detect gaps. */
    fromIndex: number;
    samples: CycleSample[];
  };
}

/** The complete surface exposed to the renderer as `window.machine`. */
export interface MachineApi {
  getSensors(): Promise<Sample | null>;
  getState(): Promise<MachineState>;
  getCycleData(): Promise<CycleData>;
  getAppInfo(): Promise<AppInfo>;
  /** Diameter-based parameters; the main process converts them to a target stroke. */
  startLinearCrimp(params: LinearCrimpParams, context: StartContext): Promise<CommandResult>;
  /** Pressure job incl. die setup, slow-down point and diameter window. */
  startPressureCrimp(params: PressureCrimpParams, context: StartContext): Promise<CommandResult>;
  stopCrimp(): Promise<CommandResult>;
  /** Operator marks one piece as bad (the "X +" button). */
  addRejected(): Promise<CommandResult>;
  /** Zeroes good / bad / total. */
  resetCounters(): Promise<CommandResult>;
  /** Declares the current ram position to be the open (zero-stroke) position. */
  teachOpenPosition(): Promise<CommandResult>;
  // ---- Database (SQLite, main process) ----
  /** All profiles with their recipe / cycle counts. */
  listProfiles(): Promise<DbResult<ProfileSummary[]>>;
  /** Creates a profile (names are unique, case-insensitive) and returns it. */
  createProfile(name: string): Promise<DbResult<Profile>>;
  listRecipes(profileId: string): Promise<DbResult<Recipe[]>>;
  /** Insert or update (by id). */
  saveRecipe(recipe: Recipe): Promise<DbResult<null>>;
  /** Soft delete - the recipe's cycle history is kept. */
  deleteRecipe(id: string): Promise<DbResult<null>>;
  /** One-time import of recipes made before the database existed. Returns how many were added. */
  importRecipes(recipes: Recipe[]): Promise<DbResult<number>>;
  /** Cycles / good / bad / last run per recipe id. */
  recipeStats(profileId: string): Promise<DbResult<Record<string, RecipeStats>>>;
  /** Cycle history, newest first. */
  listCycles(query: CycleLogQuery): Promise<DbResult<CycleLogEntry[]>>;
  /** The recorded curve of one logged cycle. */
  getCycleSamples(cycleLogId: number): Promise<DbResult<CycleSample[]>>;
  /** Returns an unsubscribe function. */
  onTick(callback: (tick: UiTick) => void): () => void;
  /** Returns an unsubscribe function. */
  onState(callback: (state: MachineState) => void): () => void;
}
