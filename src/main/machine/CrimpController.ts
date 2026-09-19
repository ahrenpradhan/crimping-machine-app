import { diameterFromDisplacement, type DieGeometry } from '../../shared/linear';
import { diameterInWindow } from '../../shared/pressure';
import type {
  CommandResult,
  CrimpMode,
  CycleTag,
  CycleSample,
  CycleSummary,
  LinearCrimpParams,
  MachineState,
  MachineStatus,
  PressureCrimpParams,
  Sample,
} from '../../shared/types';
import { GEOMETRY, LIMITS } from '../config';
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

/** Optional extras for a cycle. The controlled target itself stays a plain number. */
export interface CycleOptions {
  /** Dwell after the target is reached, before COMPLETE (ms). */
  holdTimeMs?: number;
  /** Diameter-based parameters of a LINEAR job (recorded + used for the Ø result). */
  linear?: LinearCrimpParams;
  /** Parameters of a PRESSURE job (die setup, slow-down point, diameter window). */
  pressure?: PressureCrimpParams;
  /** Who the cycle belongs to (profile / recipe). Passed through to the finished-cycle event. */
  tag?: CycleTag;
}

/** Emitted once when a cycle ends (COMPLETE, STOPPED or FAULT). */
export interface FinishedCycle {
  summary: CycleSummary;
  samples: CycleSample[];
  tag: CycleTag | null;
  faultMessage: string | null;
}

const MAX_HOLD_MS = 30_000;

type StateListener = (state: MachineState) => void;
type FinishedListener = (finished: FinishedCycle) => void;

/**
 * The machine logic. No React, no Electron, no Modbus - it only sees the
 * SensorManager's samples and drives a MachineOutput. It runs on every sample
 * (100 Hz), independent of how often the UI redraws.
 *
 * Controls on ONE quantity, monitors and records BOTH:
 *   LINEAR   -> stop when displacement >= target (stroke; the UI/IPC layer
 *               converts a target diameter into this stroke)
 *   PRESSURE -> stop when pressure     >= target (closing goes slow at the
 *               slow-down point; the final die diameter is checked against a window)
 */
export class CrimpController {
  private status: MachineStatus = 'IDLE';
  private mode: CrimpMode | null = null;
  private target: number | null = null;
  private faultMessage: string | null = null;
  private cycle: CycleSummary | null = null;
  private linearParams: LinearCrimpParams | null = null;
  private pressureParams: PressureCrimpParams | null = null;
  private slowEngaged = false;
  private holdMs = 0;
  private elapsedMs = 0;

  private good = 0;
  private bad = 0;

  private startTimestamp: number | null = null;
  private reachedCount = 0;
  private holdTimer: NodeJS.Timeout | null = null;

  private readonly recorder = new CycleRecorder();
  private readonly listeners = new Set<StateListener>();
  private readonly finishedListeners = new Set<FinishedListener>();
  private tag: CycleTag | null = null;

  private readonly onSampleBound = (sample: Sample): void => this.onSample(sample);
  private readonly onSensorFaultBound = (message: string): void => this.fault(message);

  constructor(
    private readonly sensors: SensorManager,
    private readonly output: MachineOutput,
    private readonly limits: ControllerLimits = LIMITS,
    private readonly geometry: DieGeometry = GEOMETRY,
  ) {
    sensors.on('sample', this.onSampleBound);
    sensors.on('fault', this.onSensorFaultBound);
  }

  // ---- Commands ----------------------------------------------------------

  /** Target is the STROKE (displacement) in mm the linear transducer must reach. */
  startLinearCrimp(targetDisplacementMm: number, options: CycleOptions = {}): CommandResult {
    return this.start('LINEAR', targetDisplacementMm, options);
  }

  startPressureCrimp(targetPressureBar: number, options: CycleOptions = {}): CommandResult {
    return this.start('PRESSURE', targetPressureBar, options);
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

    const wasRunning = this.cycle !== null && this.cycle.result === 'RUNNING';
    if (this.cycle && wasRunning) this.cycle.result = 'STOPPED';
    this.faultMessage = null;
    this.setStatus('IDLE');
    if (wasRunning) this.emitFinished();
    return { ok: true };
  }

  // ---- Piece counters ----------------------------------------------------

  /** Operator marks a piece as bad (the "X +" button). */
  addRejected(): CommandResult {
    this.bad++;
    this.emit();
    return { ok: true };
  }

  resetCounters(): CommandResult {
    this.good = 0;
    this.bad = 0;
    this.emit();
    return { ok: true };
  }

  // ---- Teach -------------------------------------------------------------

  /** Declares the current ram position to be the open (zero-stroke) position. */
  teachOpenPosition(): CommandResult {
    if (isBusy(this.status)) {
      return { ok: false, error: 'Cannot teach the open position while a cycle is running' };
    }
    if (this.status === 'FAULT') {
      return { ok: false, error: 'Fault active - press RESET FAULT first' };
    }
    if (this.sensors.getStatus().health !== 'OK') {
      return { ok: false, error: 'Sensors not ready' };
    }
    if (!this.sensors.teachDisplacementZero()) {
      return { ok: false, error: 'No displacement reading yet' };
    }
    this.emit();
    return { ok: true };
  }

  // ---- State -------------------------------------------------------------

  getState(): MachineState {
    return {
      status: this.status,
      mode: this.mode,
      target: this.target,
      cycleId: this.recorder.cycleId,
      elapsedMs: this.elapsedMs,
      faultMessage: this.faultMessage,
      cycle: this.cycle ? { ...this.cycle } : null,
      counters: { good: this.good, bad: this.bad, total: this.good + this.bad },
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

  /** Called once for every cycle that ends, whatever the reason (used for the history log). */
  onCycleFinished(listener: FinishedListener): () => void {
    this.finishedListeners.add(listener);
    return () => this.finishedListeners.delete(listener);
  }

  dispose(): void {
    this.output.stopClosing();
    this.clearHoldTimer();
    this.sensors.removeListener('sample', this.onSampleBound);
    this.sensors.removeListener('fault', this.onSensorFaultBound);
    this.listeners.clear();
    this.finishedListeners.clear();
  }

  // ---- Internals ---------------------------------------------------------

  private start(mode: CrimpMode, target: number, options: CycleOptions): CommandResult {
    const unit = mode === 'LINEAR' ? 'mm stroke' : 'bar';
    const max =
      mode === 'LINEAR' ? this.limits.maxTargetDisplacementMm : this.limits.maxTargetPressureBar;

    if (!Number.isFinite(target) || target <= 0) {
      return { ok: false, error: 'Target must be a number greater than 0' };
    }
    if (target > max) {
      return { ok: false, error: `Target too high (maximum ${max} ${unit})` };
    }
    const requestedHold = options.holdTimeMs ?? 0;
    if (!Number.isFinite(requestedHold) || requestedHold < 0 || requestedHold > MAX_HOLD_MS) {
      return { ok: false, error: `Hold time must be between 0 and ${MAX_HOLD_MS / 1000} s` };
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
        error: 'Die is already at/below the target diameter - open the machine first',
      };
    }
    if (mode === 'PRESSURE' && latest.pressureBar >= target) {
      return { ok: false, error: 'Pressure is already at/above the target' };
    }

    const cycleId = this.recorder.begin();
    this.mode = mode;
    this.target = target;
    this.linearParams = mode === 'LINEAR' ? (options.linear ?? null) : null;
    this.pressureParams = mode === 'PRESSURE' ? (options.pressure ?? null) : null;
    this.slowEngaged = false;
    this.tag = options.tag ? { ...options.tag } : null;
    // The output has already stopped at the target; this is how long the cycle
    // stays in TARGET_*_REACHED (dwell) - never shorter than the recording hold.
    this.holdMs = Math.max(this.limits.targetReachedHoldMs, requestedHold);
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
      finalDiameterMm: this.diameterOf(latest.displacementMm),
      peakPressureBar: latest.pressureBar,
      holdTimeMs: requestedHold,
      linear: this.linearParams ? { ...this.linearParams } : null,
      pressure: this.pressureParams ? { ...this.pressureParams } : null,
      atTarget: null,
      slowEngaged: false,
      withinTolerance: null,
    };

    this.output.startClosing();
    this.setStatus(mode === 'LINEAR' ? 'CRIMPING_LINEAR' : 'CRIMPING_PRESSURE');
    return { ok: true };
  }

  /** Die diameter for a stroke, only for cycles that carry a die setup (open diameter). */
  private diameterOf(displacementMm: number): number | null {
    const open = this.linearParams?.openDiameterMm ?? this.pressureParams?.openDiameterMm;
    if (open === undefined) return null;
    return diameterFromDisplacement(open, displacementMm, this.geometry);
  }

  /** Runs on every sample (~100 Hz). */
  private onSample(sample: Sample): void {
    const crimping = isCrimping(this.status);
    const holding = isBusy(this.status) && !crimping;
    if (!crimping && !holding) return;

    if (this.startTimestamp === null) this.startTimestamp = sample.timestamp;
    const t = sample.timestamp - this.startTimestamp;

    // Record BOTH signals for the entire cycle (including the hold after the
    // target, so the graph shows where the ram really stopped and the dwell).
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
      this.cycle.finalDiameterMm = this.diameterOf(sample.displacementMm);
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

    // ---- Pressure mode: fast -> slow at the slow-down point ---------------
    if (this.mode === 'PRESSURE' && this.pressureParams && !this.slowEngaged) {
      const p = this.pressureParams;
      const diameter = this.diameterOf(sample.displacementMm);
      if (
        (diameter !== null && diameter <= p.slowSwitchDiameterMm) ||
        sample.pressureBar >= p.slowSwitchPressureBar
      ) {
        this.slowEngaged = true;
        if (this.cycle) this.cycle.slowEngaged = true;
        this.output.setClosingSpeed('SLOW');
      }
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

    // Pressure mode: is the die diameter reached at the target pressure inside
    // the accepted window? Judged now (at the stop), not after the dwell.
    if (this.cycle) {
      this.cycle.atTarget = {
        pressureBar: this.cycle.finalPressureBar,
        displacementMm: this.cycle.finalDisplacementMm,
        diameterMm: this.cycle.finalDiameterMm,
      };
    }
    let withinTolerance: boolean | null = null;
    const reachedDiameter = this.cycle?.finalDiameterMm ?? null;
    if (this.mode === 'PRESSURE' && this.pressureParams && reachedDiameter !== null) {
      withinTolerance = diameterInWindow(reachedDiameter, this.pressureParams);
    }

    this.holdTimer = setTimeout(() => {
      this.holdTimer = null;
      if (this.cycle) {
        this.cycle.result = 'COMPLETE';
        this.cycle.withinTolerance = withinTolerance;
      }
      if (withinTolerance === false) this.bad++;
      else this.good++;
      this.setStatus('COMPLETE');
      this.emitFinished();
    }, this.holdMs);
  }

  /** Any state -> FAULT. Always stops closing. */
  private fault(message: string): void {
    this.output.stopClosing();
    this.clearHoldTimer();
    const wasRunning = this.cycle !== null && this.cycle.result === 'RUNNING';
    if (this.cycle && wasRunning) this.cycle.result = 'FAULT';
    this.faultMessage = message;
    this.setStatus('FAULT');
    if (wasRunning) this.emitFinished();
  }

  private emitFinished(): void {
    if (!this.cycle) return;
    const finished: FinishedCycle = {
      summary: { ...this.cycle },
      samples: this.recorder.getAll(),
      tag: this.tag ? { ...this.tag } : null,
      faultMessage: this.faultMessage,
    };
    for (const listener of this.finishedListeners) {
      try {
        listener(finished);
      } catch (err) {
        console.error('[CrimpController] finished-cycle listener failed:', err);
      }
    }
  }

  private setStatus(status: MachineStatus): void {
    this.status = status;
    this.emit();
  }

  private emit(): void {
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
