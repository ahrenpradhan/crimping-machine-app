import type { Sample } from './sensors';

/** The only two operating modes. */
export type CrimpMode = 'LINEAR' | 'PRESSURE';

/**
 * IDLE -> CRIMPING_* -> TARGET_*_REACHED -> COMPLETE, and any state -> FAULT.
 */
export type MachineStatus =
  | 'IDLE'
  | 'CRIMPING_LINEAR'
  | 'TARGET_DISPLACEMENT_REACHED'
  | 'CRIMPING_PRESSURE'
  | 'TARGET_PRESSURE_REACHED'
  | 'COMPLETE'
  | 'FAULT';

export type CycleResult = 'RUNNING' | 'COMPLETE' | 'STOPPED' | 'FAULT';

/** One recorded point of a crimp cycle. `timestamp` is ms since cycle start. */
export type CycleSample = Sample;

/**
 * Parameters of a CRIMP BY LINEAR job, modelled on the Uniflex screen.
 * The operator thinks in die diameters; the controller still stops on the
 * linear transducer (see shared/linear.ts for the diameter <-> stroke maths).
 */
export interface LinearCrimpParams {
  /** Target crimp diameter (mm). */
  targetDiameterMm: number;
  /**
   * Signed correction added to the target (mm). Positive = larger final
   * diameter (stops earlier), negative = crimps further. Used to trim out
   * spring-back after measuring a finished piece.
   */
  correctionMm: number;
  /** Installed die-set size (mm). Recorded with each cycle. */
  dieSizeMm: number;
  /** Die opening diameter at the open (zero-stroke) position (mm). */
  openDiameterMm: number;
  /** Dwell after the target is reached, before the cycle completes (seconds). */
  holdTimeSec: number;
}

/**
 * Parameters of a CRIMP BY PRESSURE job, modelled on the Uniflex pressure screen.
 * The controller stops on pressure; the diameters are used for the die setup,
 * the slow-down point and the final-diameter tolerance check.
 */
export interface PressureCrimpParams {
  /** Pressure at which closing stops (bar). */
  targetPressureBar: number;
  /** Installed die-set size (mm). Shared with the linear mode's die setup. */
  dieSizeMm: number;
  /** Die opening diameter at the open (zero-stroke) position (mm). Shared. */
  openDiameterMm: number;
  /** Dwell after the target is reached, before the cycle completes (seconds). */
  holdTimeSec: number;
  /**
   * Slow-down point: closing runs fast until the die diameter falls to this
   * value OR the pressure reaches `slowSwitchPressureBar` (whichever happens
   * first), then continues slowly up to the target pressure.
   */
  slowSwitchDiameterMm: number;
  slowSwitchPressureBar: number;
  /** Accepted window for the die diameter reached at the target pressure (mm). */
  minDiameterMm: number;
  maxDiameterMm: number;
}

/** Piece counters. `total` = `good` + `bad`. */
export interface PieceCounters {
  good: number;
  bad: number;
  total: number;
}

/** What the machine read at the instant the target was reached (before the dwell). */
export interface CycleAtTarget {
  pressureBar: number;
  displacementMm: number;
  /** Die diameter then (null when the cycle carries no die setup). */
  diameterMm: number | null;
}

export interface CycleSummary {
  cycleId: number;
  mode: CrimpMode;
  /** Controlled quantity: displacement (stroke) in mm for LINEAR, bar for PRESSURE. */
  target: number;
  result: CycleResult;
  durationMs: number;
  finalPressureBar: number;
  finalDisplacementMm: number;
  /** Die diameter at the end of the cycle (null when the cycle carries no die setup). */
  finalDiameterMm: number | null;
  peakPressureBar: number;
  /** Dwell requested for this cycle (ms). */
  holdTimeMs: number;
  /** The diameter-based parameters this cycle was started with (LINEAR only). */
  linear: LinearCrimpParams | null;
  /** The parameters this cycle was started with (PRESSURE with die setup only). */
  pressure: PressureCrimpParams | null;
  /** Readings at the moment the target was reached; null until then. */
  atTarget: CycleAtTarget | null;
  /** PRESSURE: the slow-down point was reached and closing switched to slow. */
  slowEngaged: boolean;
  /**
   * PRESSURE: was the die diameter at the target pressure inside the accepted
   * window? null = not checked (no die setup) or cycle not completed.
   * Out-of-tolerance cycles count as Bad.
   */
  withinTolerance: boolean | null;
}

export interface MachineState {
  status: MachineStatus;
  mode: CrimpMode | null;
  target: number | null;
  /** 0 = no cycle has been run yet. Increments on every START. */
  cycleId: number;
  elapsedMs: number;
  faultMessage: string | null;
  cycle: CycleSummary | null;
  counters: PieceCounters;
}

export interface CommandResult {
  ok: boolean;
  error?: string;
}
