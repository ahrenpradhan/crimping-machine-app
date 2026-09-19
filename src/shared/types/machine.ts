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

export interface CycleSummary {
  cycleId: number;
  mode: CrimpMode;
  /** mm for LINEAR, bar for PRESSURE. */
  target: number;
  result: CycleResult;
  durationMs: number;
  finalPressureBar: number;
  finalDisplacementMm: number;
  peakPressureBar: number;
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
}

export interface CommandResult {
  ok: boolean;
  error?: string;
}
