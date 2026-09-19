import type { CommandResult, CycleSample, MachineState } from './machine';
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
  /** main -> renderer, ~15 Hz */
  tick: 'machine:tick',
  /** main -> renderer, immediately on every state transition */
  state: 'machine:state',
} as const;

export interface AppInfo {
  simulation: boolean;
  sampleRateHz: number;
  uiRateHz: number;
  limits: {
    maxTargetDisplacementMm: number;
    maxTargetPressureBar: number;
  };
}

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
  startLinearCrimp(targetMm: number): Promise<CommandResult>;
  startPressureCrimp(targetBar: number): Promise<CommandResult>;
  stopCrimp(): Promise<CommandResult>;
  /** Returns an unsubscribe function. */
  onTick(callback: (tick: UiTick) => void): () => void;
  /** Returns an unsubscribe function. */
  onState(callback: (state: MachineState) => void): () => void;
}
