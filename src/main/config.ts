/**
 * ALL tunable constants live here so they are easy to change later.
 * (No settings UI yet, as per the v1 scope.)
 *
 * Environment overrides (handy on the Raspberry Pi):
 *   CRIMP_SIMULATION=false   use real Modbus hardware instead of the simulator
 *   CRIMP_SERIAL_PORT=/dev/ttyUSB0   (or COM3 on Windows)
 *   CRIMP_BAUD=38400
 *   CRIMP_KIOSK=1            fullscreen kiosk window
 *   CRIMP_DEVTOOLS=1         open DevTools
 *   CRIMP_DB_PATH=...        SQLite file (default: <app data folder>/crimping.db)
 */
import type { DieGeometry } from '../shared/linear';
import type { SensorCalibration } from '../shared/types';

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

/** true = generated data, no hardware needed. */
export const SIMULATION: boolean = envFlag('CRIMP_SIMULATION', true);

/** SQLite history (recipes + every crimp cycle). */
export const HISTORY = {
  fileName: 'crimping.db',
  /** Also store each cycle's recorded pressure/displacement curve (about 10 KB per cycle). */
  logSamples: true,
} as const;

export const TIMING = {
  /** Sensor acquisition + machine logic rate. */
  sampleRateHz: 100,
  /** How often batched updates are pushed to the UI. */
  uiRateHz: 15,
} as const;

/** Modbus RTU / RS485 serial link (USB-RS485 adapter). Placeholder values. */
export const SERIAL = {
  path:
    process.env.CRIMP_SERIAL_PORT ??
    (process.platform === 'win32' ? 'COM3' : '/dev/ttyUSB0'),
  // 100 Hz needs >= 38400 baud (see README). 9600 baud tops out near 50 Hz.
  baudRate: Number(process.env.CRIMP_BAUD) || 38400,
  parity: 'none' as 'none' | 'even' | 'odd',
  dataBits: 8 as const,
  stopBits: 1 as const,
  /** Per-request response timeout. Must be well under one sample period x a few. */
  timeoutMs: 100,
};

/** Basic software limits - NOT a safety system. */
export const LIMITS = {
  /** Largest target the operator may enter. */
  maxTargetDisplacementMm: 45,
  maxTargetPressureBar: 400,
  /** Hard software ceilings: exceeding either raises FAULT and stops closing. */
  maxDisplacementMm: 48,
  maxPressureBar: 450,
  /** A cycle that has not reached its target after this long raises FAULT. */
  cycleTimeoutMs: 30_000,
  /** Consecutive samples at/over target required (rejects single-sample noise). */
  targetConfirmSamples: 2,
  /** How long TARGET_*_REACHED is shown/recorded before COMPLETE. */
  targetReachedHoldMs: 300,
} as const;

/**
 * CRIMP BY LINEAR is set up in die diameters (like the Uniflex screen) but
 * stops on the linear transducer's stroke:
 *
 *   diameter = openDiameter - diameterMmPerStrokeMm x displacement
 *
 * PLACEHOLDER: 1.0 means 1 mm of measured stroke closes the die by 1 mm of
 * diameter. Set the real ratio for your machine (radial segments + ram
 * geometry) - it directly decides where a diameter target stops the ram.
 */
export const GEOMETRY: DieGeometry = {
  diameterMmPerStrokeMm: 1,
};

/** Sensor-manager behaviour. */
export const ACQUISITION = {
  /** This many failed/invalid reads in a row = sensor FAULT (10 @ 100 Hz = 100 ms). */
  maxConsecutiveErrors: 10,
  /** Minimum gap between Modbus reconnect attempts. */
  reconnectIntervalMs: 1000,
} as const;

/**
 * Linear transducer: 0-10 V -> 0-50 mm.
 * `rawFullScale` is a placeholder (12-bit ADC = 4095 counts at 10 V). Set it
 * to whatever your I/O module actually reports (see RegisterMap.ts).
 */
export const LINEAR_SENSOR: SensorCalibration = {
  inputType: '0-10V',
  rawFullScale: 4095,
  engMin: 0,
  engMax: 50,
  zeroOffset: 0,
};

/**
 * Pressure transducer: 0-10 V (or 4-20 mA) -> 0-600 bar.
 * Change `inputType` to '4-20mA' if that is what the transducer outputs; the
 * scaling and wire-break detection (< 3.5 mA) follow automatically.
 */
export const PRESSURE_SENSOR: SensorCalibration = {
  inputType: '0-10V',
  rawFullScale: 4095,
  engMin: 0,
  engMax: 600,
  zeroOffset: 0,
};
