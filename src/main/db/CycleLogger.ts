import { DEFAULT_PROFILE } from '../../shared/recipe';
import type { CycleLogInput, MachineStore } from './MachineStore';
import type { CrimpController, FinishedCycle } from '../machine/CrimpController';
import type { LoggedResult } from '../../shared/types';

export interface CycleLoggerOptions {
  /** Store the recorded pressure/displacement curve of every cycle too. */
  logSamples: boolean;
  /** Identifies this run of the app in the history (default: start time). */
  sessionId?: string;
  now?: () => number;
}

/**
 * Files every finished cycle in the database. It listens to the controller, so
 * the control loop never knows a database exists - and a database problem can
 * never stop or fault a crimp: writes happen just after the event
 * (setImmediate) and every error is caught and logged.
 */
export class CycleLogger {
  private readonly sessionId: string;
  private readonly now: () => number;
  private lastLoggedId: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private pending = 0;

  constructor(
    private readonly store: MachineStore,
    private readonly opts: CycleLoggerOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.sessionId = opts.sessionId ?? String(this.now());
  }

  attach(controller: CrimpController): void {
    this.detach();
    this.unsubscribe = controller.onCycleFinished((f) => {
      this.pending++;
      setImmediate(() => {
        try {
          this.write(f);
        } catch (err) {
          console.error('[CycleLogger] could not save the cycle:', err instanceof Error ? err.message : err);
        } finally {
          this.pending--;
        }
      });
    });
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** The operator marked the last piece as bad ("+" on the counter). */
  markLastRejected(): void {
    if (this.lastLoggedId === null) return;
    try {
      this.store.markCycleRejected(this.lastLoggedId);
    } catch (err) {
      console.error('[CycleLogger] could not mark the piece as rejected:', err instanceof Error ? err.message : err);
    }
  }

  /** Resolves when every queued write has finished (used by tests and shutdown). */
  async flush(): Promise<void> {
    while (this.pending > 0) await new Promise<void>((r) => setImmediate(r));
  }

  private write(f: FinishedCycle): void {
    const s = f.summary;
    if (s.result === 'RUNNING') return;
    const finishedAt = this.now();
    const params = s.pressure ?? s.linear ?? null;
    const entry: CycleLogInput = {
      profileId: f.tag?.profileId ?? DEFAULT_PROFILE.id,
      recipeId: f.tag?.recipeId ?? null,
      recipeName: f.tag?.recipeName ?? null,
      recipeModified: f.tag?.recipeModified ?? false,
      sessionId: this.sessionId,
      cycleNumber: s.cycleId,
      mode: s.mode,
      result: s.result as LoggedResult,
      startedAt: finishedAt - s.durationMs,
      finishedAt,
      durationMs: s.durationMs,
      target: s.target,
      holdTimeMs: s.holdTimeMs,
      finalPressureBar: s.finalPressureBar,
      finalDisplacementMm: s.finalDisplacementMm,
      finalDiameterMm: s.finalDiameterMm,
      peakPressureBar: s.peakPressureBar,
      atTargetPressureBar: s.atTarget?.pressureBar ?? null,
      atTargetDisplacementMm: s.atTarget?.displacementMm ?? null,
      atTargetDiameterMm: s.atTarget?.diameterMm ?? null,
      slowEngaged: s.slowEngaged,
      withinTolerance: s.withinTolerance,
      faultMessage: f.faultMessage,
      params,
      samples: this.opts.logSamples ? f.samples : null,
    };
    this.lastLoggedId = this.store.logCycle(entry);
  }
}
