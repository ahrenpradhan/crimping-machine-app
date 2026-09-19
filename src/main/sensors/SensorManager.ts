import { EventEmitter } from 'node:events';
import type { RawSample, Sample, SensorHealth, SensorStatus } from '../../shared/types';
import { ACQUISITION, TIMING } from '../config';
import type { IModbusClient } from '../modbus/ModbusClient';
import { LinearSensor } from './LinearSensor';
import { PressureSensor } from './PressureSensor';

export interface SensorManagerOptions {
  sampleRateHz: number;
  maxConsecutiveErrors: number;
  reconnectIntervalMs: number;
}

const DEFAULT_OPTIONS: SensorManagerOptions = {
  sampleRateHz: TIMING.sampleRateHz,
  maxConsecutiveErrors: ACQUISITION.maxConsecutiveErrors,
  reconnectIntervalMs: ACQUISITION.reconnectIntervalMs,
};

// Typed events. 'sample' fires at the acquisition rate (~100 Hz).
export interface SensorManager {
  on(event: 'sample', listener: (sample: Sample) => void): this;
  on(event: 'fault', listener: (message: string) => void): this;
  on(event: 'recovered', listener: () => void): this;
}

/**
 * Owns the acquisition loop. Independent of React and of the UI rate:
 *   Modbus -> raw counts -> volts/mA -> engineering units -> 'sample' event.
 * Both transducers are always read, whatever crimp mode is selected.
 */
export class SensorManager extends EventEmitter {
  private running = false;
  private loop: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private wake: (() => void) | null = null;

  private latest: Sample | null = null;
  private latestRaw: RawSample | null = null;

  // "Teach open position": displacement zero offset (mm), applied to every sample.
  private zeroOffsetMm = 0;
  /** Last ~0.25 s of displacement readings BEFORE the zero offset, for teaching. */
  private recentUncorrected: number[] = [];

  private health: SensorHealth = 'STARTING';
  private message: string | null = null;
  private consecutiveErrors = 0;
  private lastReconnectAttempt = -Infinity;

  private rateWindowStart = performance.now();
  private rateCount = 0;
  private measuredRateHz = 0;

  constructor(
    private readonly client: IModbusClient,
    private readonly options: SensorManagerOptions = DEFAULT_OPTIONS,
    private readonly linear: LinearSensor = new LinearSensor(),
    private readonly pressure: PressureSensor = new PressureSensor(),
  ) {
    super();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.wake?.();
    await this.loop;
    this.loop = null;
  }

  // ---- Latest values (engineering units) ---------------------------------
  getPressure(): number | null {
    return this.latest?.pressureBar ?? null;
  }
  getDisplacement(): number | null {
    return this.latest?.displacementMm ?? null;
  }
  // ---- Latest values (raw ADC counts) ------------------------------------
  getRawPressure(): number | null {
    return this.latestRaw?.pressureRaw ?? null;
  }
  getRawDisplacement(): number | null {
    return this.latestRaw?.displacementRaw ?? null;
  }
  getLatestSample(): Sample | null {
    return this.latest;
  }

  getStatus(): SensorStatus {
    return {
      health: this.health,
      message: this.message,
      connection: this.client.getConnectionStatus(),
      measuredRateHz: this.measuredRateHz,
      zeroOffsetMm: this.zeroOffsetMm,
    };
  }

  /**
   * Declares the current ram position to be displacement = 0 (the open
   * position). Uses the average of the last ~0.25 s so sensor noise is not
   * baked into the offset. Returns false if there is no data yet.
   * (Kept in memory only - there is no persistent storage in v1.)
   */
  teachDisplacementZero(): boolean {
    if (this.recentUncorrected.length === 0) return false;
    const sum = this.recentUncorrected.reduce((a, b) => a + b, 0);
    this.zeroOffsetMm = sum / this.recentUncorrected.length;
    if (this.latest) this.latest = { ...this.latest, displacementMm: 0 };
    return true;
  }

  /** Removes the taught zero offset. */
  resetDisplacementZero(): void {
    this.zeroOffsetMm = 0;
  }

  // ---- Loop --------------------------------------------------------------
  private async run(): Promise<void> {
    const period = 1000 / this.options.sampleRateHz;
    let next = performance.now();

    while (this.running) {
      const sample = await this.acquire();
      // Emit outside acquire()'s try/catch so a listener bug can't be
      // mistaken for a sensor error.
      if (sample) this.emit('sample', sample);

      next += period;
      const now = performance.now();
      // Fell far behind (e.g. slow bus)? Re-sync instead of firing a burst.
      if (next < now - period * 5) next = now;
      await this.sleep(Math.max(0, next - now));
    }
  }

  private async acquire(): Promise<Sample | null> {
    try {
      if (this.client.getConnectionStatus() !== 'connected') {
        await this.tryReconnect();
        throw new Error('Modbus not connected');
      }
      const raw = await this.client.readAnalogInputs();
      const displacement = this.linear.convert(raw.displacement);
      const pressure = this.pressure.convert(raw.pressure);

      const timestamp = Date.now();
      this.latestRaw = {
        timestamp,
        pressureRaw: raw.pressure,
        displacementRaw: raw.displacement,
      };
      this.recentUncorrected.push(displacement.value);
      if (this.recentUncorrected.length > 25) this.recentUncorrected.shift();
      this.latest = {
        timestamp,
        pressureBar: pressure.value,
        displacementMm: displacement.value - this.zeroOffsetMm,
      };
      this.onGoodRead();
      return this.latest;
    } catch (err) {
      this.onBadRead(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  private async tryReconnect(): Promise<void> {
    const now = performance.now();
    if (now - this.lastReconnectAttempt < this.options.reconnectIntervalMs) return;
    this.lastReconnectAttempt = now;
    try {
      await this.client.connect();
    } catch (err) {
      this.message = err instanceof Error ? err.message : String(err);
    }
  }

  private onGoodRead(): void {
    this.consecutiveErrors = 0;
    if (this.health !== 'OK') {
      const was = this.health;
      this.health = 'OK';
      this.message = null;
      if (was === 'FAULT') this.emit('recovered');
    }
    // Measure the real acquisition rate over 1 s windows.
    this.rateCount++;
    const now = performance.now();
    if (now - this.rateWindowStart >= 1000) {
      this.measuredRateHz = Math.round((this.rateCount * 1000) / (now - this.rateWindowStart));
      this.rateCount = 0;
      this.rateWindowStart = now;
    }
  }

  private onBadRead(message: string): void {
    this.consecutiveErrors++;
    this.message = message;
    if (this.consecutiveErrors >= this.options.maxConsecutiveErrors && this.health !== 'FAULT') {
      this.health = 'FAULT';
      this.measuredRateHz = 0;
      this.emit('fault', `Sensor fault: ${message}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve;
      this.timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
    });
  }
}
