import type { PressureCrimpParams } from './types';

/**
 * Parameters + validation for CRIMP BY PRESSURE (shared by the main process,
 * which validates IPC input, and the renderer, which stores/edits them).
 */
export const DEFAULT_PRESSURE_PARAMS: PressureCrimpParams = {
  targetPressureBar: 250,
  dieSizeMm: 32,
  openDiameterMm: 74,
  holdTimeSec: 1,
  // Values shown on the Uniflex pressure screen.
  slowSwitchDiameterMm: 38.2,
  slowSwitchPressureBar: 50,
  minDiameterMm: 31.4,
  maxDiameterMm: 52,
};

export const PRESSURE_PARAM_LIMITS = {
  targetPressureBar: { min: 1, max: 600 },
  dieSizeMm: { min: 5, max: 150 },
  openDiameterMm: { min: 20, max: 200 },
  holdTimeSec: { min: 0, max: 30 },
  slowSwitchDiameterMm: { min: 5, max: 200 },
  slowSwitchPressureBar: { min: 1, max: 600 },
  minDiameterMm: { min: 5, max: 200 },
  maxDiameterMm: { min: 5, max: 200 },
} as const;

const KEYS = Object.keys(PRESSURE_PARAM_LIMITS) as Array<keyof PressureCrimpParams>;

const LABELS: Record<keyof PressureCrimpParams, string> = {
  targetPressureBar: 'Target pressure',
  dieSizeMm: 'Die size',
  openDiameterMm: 'Open diameter',
  holdTimeSec: 'Hold time',
  slowSwitchDiameterMm: 'Slow-down diameter',
  slowSwitchPressureBar: 'Slow-down pressure',
  minDiameterMm: 'Minimum diameter',
  maxDiameterMm: 'Maximum diameter',
};

/** Same parameter set (used to tell whether the operator edited a loaded recipe)? */
export function samePressureParams(a: PressureCrimpParams, b: PressureCrimpParams): boolean {
  return KEYS.every((k) => Math.abs(a[k] - b[k]) < 1e-9);
}

/** Is the diameter inside the accepted window? */
export function diameterInWindow(
  diameterMm: number,
  p: Pick<PressureCrimpParams, 'minDiameterMm' | 'maxDiameterMm'>,
): boolean {
  return diameterMm >= p.minDiameterMm && diameterMm <= p.maxDiameterMm;
}

export type ParsedPressureParams =
  | { ok: true; params: PressureCrimpParams }
  | { ok: false; error: string };

/** Validates untrusted input (IPC) into PressureCrimpParams. */
export function parsePressureParams(raw: unknown): ParsedPressureParams {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'Invalid pressure crimp parameters' };
  }
  const source = raw as Record<string, unknown>;
  const out = {} as PressureCrimpParams;
  for (const key of KEYS) {
    const value = source[key];
    const { min, max } = PRESSURE_PARAM_LIMITS[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: `${LABELS[key]} must be a number` };
    }
    if (value < min || value > max) {
      return { ok: false, error: `${LABELS[key]} must be between ${min} and ${max}` };
    }
    out[key] = value;
  }
  if (out.minDiameterMm >= out.maxDiameterMm) {
    return { ok: false, error: 'Minimum diameter must be smaller than the maximum diameter' };
  }
  return { ok: true, params: out };
}

/** Lenient version for stored values: fills gaps from the defaults and clamps. */
export function coercePressureParams(raw: unknown): PressureCrimpParams | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const out = { ...DEFAULT_PRESSURE_PARAMS };
  for (const key of KEYS) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const { min, max } = PRESSURE_PARAM_LIMITS[key];
      out[key] = Math.min(max, Math.max(min, value));
    }
  }
  return out;
}
