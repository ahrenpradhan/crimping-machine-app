import type {
  CommandResult,
  CrimpMode,
  CycleSample,
  CycleSummary,
  MachineState,
  MachineStatus,
  Sample,
} from '../../shared/types';
import { LIMITS } from '../config';
import type { SensorManager } from '../sensors/SensorManager';
import { CycleRecorder } from './CycleRecorder';
import type { MachineOutput } from './MachineOutput';
import { isBusy, isCrimping } from './MachineState';

export type ControllerLimits = {
  maxTargetDisplacementMm: number;
  maxTargetPressureBar: number;
  maxDisplacementMm: number;
  maxPressureBar: number;
  cycleTimeoutMs: number;
  targetConfirmSamples: number;
  targetReachedHoldMs: number;
};

type StateListener = (state: MachineState) => void;

/**
 * The machine logic. No React, no Electron, no Modbus - it only sees the
 * SensorManager's samples and drives a MachineOutput. It runs on every sample
 * (100 Hz), independent of how often the UI redraws.
 *
 * Controls on ONE quantity, monitors and records BOTH:
 *   LINEAR   -> stop when displacement >= target
 *   PRESSURE -> stop when pressure     >= target
 */
export class CrimpController {
  private status: MachineStatus = 'IDLE';
  private mode: CrimpMode | null = null;
  private target: number | null = null;
  private faultMessage: string | null = null;
  private cycle: CycleSummary | null = null;
  private elapsedMs = 0;

  private startTimestamp: number | null = null;
  private reachedCount = 0;
  private holdTimer: NodeJS.Timeout | null = null;

  private readonly recorder = new CycleRecorder();
  private readonly listeners = new Set<StateListener>();

  private readonly onSampleBound = (sample: Sample): void => this.onSample(sample);
  private readonly onSensorFaultBound = (message: string): void => this.fault(message);

  constructor(
    private readonly sensors: SensorManager,
    private readonly output: MachineOutput,
    private readonly limits: ControllerLimits = LIMITS,
  ) {
    sensors.on('sample', this.onSampleBound);
    sensors.on('fault', this.onSensorFaultBound);
  }

  // ---- Commands ----------------------------------------------------------

  startLinearCrimp(targetDisplacementMm: number): CommandResult {
    return this.start('LINEAR', targetDisplacementMm);
  }

  startPressureCrimp(targetPressureBar: number): CommandResult {
    return this.start('PRESSURE', targetPressureBar);
  }

  /**
   * Stops closing. From a crimping state -> IDLE (data kept, result STOPPED).
   * From COMPLETE -> IDLE. From FAULT -> IDLE (acknowledges the fault).
   */
  stopCrimp(): CommandResult {
    // Always command the output off, whatever state we think we are in.
    this.output.stopClosing();
    this.clearHoldTimer();

    if (this.status === 'IDLE') return { ok: true };

    if (this.cycle && this.cycle.result === 'RUNNING') {
      this.cycle.result = 'STOPPED';
    }
    this.faultMessage = null;
    this.setStatus('IDLE');
    return { ok: true };
  }

  getState(): MachineState {
    return {
      status: this.status,
      mode: this.mode,
      target: this.target,
      cycleId: this.recorder.cycleId,
      elapsedMs: this.elapsedMs,
      faultMessage: this.faultMessage,
      cycle: this.cycle ? { ...this.cycle } : null,
    };
  }

  // ---- Cycle data (in-memory) -------------------------------------------
  getCycleId(): number {
    return this.recorder.cycleId;
  }
  getCycleSamples(): CycleSample[] {
    return this.recorder.getAll();
  }
  getCycleSamplesFrom(index: number): CycleSample[] {
    return this.recorder.getFrom(index);
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.output.stopClosing();
    this.clearHoldTimer();
    this.sensors.removeListener('sample', this.onSampleBound);
    this.sensors.removeListener('fault', this.onSensorFaultBound);
    this.listeners.clear();
  }

  // ---- Internals ---------------------------------------------------------

  private start(mode: CrimpMode, target: number): CommandResult {
    const unit = mode === 'LINEAR' ? 'mm' : 'bar';
    const max =
      mode === 'LINEAR' ? this.limits.maxTargetDisplacementMm : this.limits.maxTargetPressureBar;

    if (!Number.isFinite(target) || target <= 0) {
      return { ok: false, error: 'Target must be a number greater than 0' };
    }
    if (target > max) {
      return { ok: false, error: `Target too high (maximum ${max} ${unit})` };
    }
    if (isBusy(this.status)) {
      return { ok: false, error: 'A crimp cycle is already running' };
    }
    if (this.status === 'FAULT') {
      return { ok: false, error: 'Fault active - press RESET FAULT first' };
    }

    const latest = this.sensors.getLatestSample();
    if (this.sensors.getStatus().health !== 'OK' || !latest) {
      return { ok: false, error: 'Sensors not ready' };
    }
    if (mode === 'LINEAR' && latest.displacementMm >= target) {
      return {
        ok: false,
        error: 'Displacement is already at/above the target - open the machine first',
      };
    }
    if (mode === 'PRESSURE' && latest.pressureBar >= target) {
      return { ok: false, error: 'Pressure is already at/above the target' };
    }

    const cycleId = this.recorder.begin();
    this.mode = mode;
    this.target = target;
    this.faultMessage = null;
    this.startTimestamp = null; // set from the first sample of the cycle
    this.reachedCount = 0;
    this.elapsedMs = 0;
    this.cycle = {
      cycleId,
      mode,
      target,
      result: 'RUNNING',
      durationMs: 0,
      finalPressureBar: latest.pressureBar,
      finalDisplacementMm: latest.displacementMm,
      peakPressureBar: latest.pressureBar,
    };

    this.output.startClosing();
    this.setStatus(mode === 'LINEAR' ? 'CRIMPING_LINEAR' : 'CRIMPING_PRESSURE');
    return { ok: true };
  }

  /** Runs on every sample (~100 Hz). */
  private onSample(sample: Sample): void {
    const crimping = isCrimping(this.status);
    const holding = isBusy(this.status) && !crimping;
    if (!crimping && !holding) return;

    if (this.startTimestamp === null) this.startTimestamp = sample.timestamp;
    const t = sample.timestamp - this.startTimestamp;

    // Record BOTH signals for the entire cycle (including the short hold after
    // the target, so the graph shows where the ram really stopped).
    this.recorder.push({
      timestamp: t,
      pressureBar: sample.pressureBar,
      displacementMm: sample.displacementMm,
    });
    this.elapsedMs = t;
    if (this.cycle) {
      this.cycle.durationMs = t;
      this.cycle.finalPressureBar = sample.pressureBar;
      this.cycle.finalDisplacementMm = sample.displacementMm;
      this.cycle.peakPressureBar = this.recorder.getPeakPressure();
    }

    if (holding) return;

    // ---- Basic software faults (NOT a safety system) ---------------------
    if (sample.displacementMm > this.limits.maxDisplacementMm) {
      this.fault(`Displacement limit exceeded (${sample.displacementMm.toFixed(1)} mm)`);
      return;
    }
    if (sample.pressureBar > this.limits.maxPressureBar) {
      this.fault(`Pressure limit exceeded (${sample.pressureBar.toFixed(0)} bar)`);
      return;
    }
    if (t > this.limits.cycleTimeoutMs) {
      this.fault('Cycle timeout - target not reached');
      return;
    }

    // ---- Target detection -------------------------------------------------
    const controlled = this.mode === 'LINEAR' ? sample.displacementMm : sample.pressureBar;
    if (this.target !== null && controlled >= this.target) {
      this.reachedCount++;
    } else {
      this.reachedCount = 0;
    }
    if (this.reachedCount >= this.limits.targetConfirmSamples) {
      this.targetReached();
    }
  }

  private targetReached(): void {
    this.output.stopClosing();
    this.setStatus(
      this.mode === 'LINEAR' ? 'TARGET_DISPLACEMENT_REACHED' : 'TARGET_PRESSURE_REACHED',
    );
    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (this.cycle) this.cycle.result = 'COMPLETE';
      this.setStatus('COMPLETE');
    }, this.limits.targetReachedHoldMs);
  }

  /** Any state -> FAULT. Always stops closing. */
  private fault(message: string): void {
    this.output.stopClosing();
    this.clearHoldTimer();
    if (this.cycle && this.cycle.result === 'RUNNING') this.cycle.result = 'FAULT';
    this.faultMessage = message;
    this.setStatus('FAULT');
  }

  private setStatus(status: MachineStatus): void {
    this.status = status;
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('[CrimpController] state listener failed:', err);
      }
    }
  }

  private clearHoldTimer(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }
}
