import type { CycleSample } from '../../shared/types';

/**
 * In-memory record of the current/last crimp cycle (no database yet).
 * Timestamps are milliseconds since the cycle started.
 */
export class CycleRecorder {
  private id = 0;
  private samples: CycleSample[] = [];
  private peakPressureBar = 0;

  /** 100 Hz x 60 s. The cycle timeout faults well before this. */
  constructor(private readonly maxSamples = 6000) {}

  /** Start a fresh cycle (discards the previous one) and return its id. */
  begin(): number {
    this.id++;
    this.samples = [];
    this.peakPressureBar = 0;
    return this.id;
  }

  push(sample: CycleSample): void {
    if (this.samples.length >= this.maxSamples) return;
    this.samples.push(sample);
    if (sample.pressureBar > this.peakPressureBar) this.peakPressureBar = sample.pressureBar;
  }

  get cycleId(): number {
    return this.id;
  }

  get length(): number {
    return this.samples.length;
  }

  getPeakPressure(): number {
    return this.peakPressureBar;
  }

  getAll(): CycleSample[] {
    return this.samples.slice();
  }

  getFrom(index: number): CycleSample[] {
    return this.samples.slice(Math.max(0, index));
  }
}
