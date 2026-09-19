/** The two physical analog channels on the I/O module. */
export type AnalogChannel = 'displacement' | 'pressure';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Electrical signal type wired to an analog input. */
export type AnalogInputType = '0-10V' | '4-20mA';

/**
 * Simple per-sensor calibration constants (no settings UI yet - these live in
 * src/main/config.ts).
 */
export interface SensorCalibration {
  inputType: AnalogInputType;
  /**
   * Raw ADC counts the I/O module reports at electrical full scale
   * (10 V for a 0-10 V input, 20 mA for a 4-20 mA input).
   */
  rawFullScale: number;
  /** Engineering value at the bottom of the signal range (0 V / 4 mA). */
  engMin: number;
  /** Engineering value at the top of the signal range (10 V / 20 mA). */
  engMax: number;
  /** Zero trim added after scaling (same unit as the engineering value). */
  zeroOffset: number;
}

/** One reading of both sensors, in engineering units. */
export interface Sample {
  /** Epoch milliseconds for live samples; ms since cycle start for cycle data. */
  timestamp: number;
  pressureBar: number;
  displacementMm: number;
}

/** Raw ADC counts straight from the Modbus registers. */
export interface RawSample {
  timestamp: number;
  pressureRaw: number;
  displacementRaw: number;
}

export type SensorHealth = 'STARTING' | 'OK' | 'FAULT';

export interface SensorStatus {
  health: SensorHealth;
  message: string | null;
  connection: ConnectionStatus;
  /** Actual acquisition rate measured over the last second. */
  measuredRateHz: number;
  /** Displacement zero offset set by "teach open position" (mm, 0 = not taught). */
  zeroOffsetMm: number;
}
