import type { LinearCrimpParams } from './types';

/**
 * Diameter <-> stroke maths for CRIMP BY LINEAR. Shared by the main process
 * (which decides when to stop) and the renderer (which shows the die diameter).
 *
 *   diameter = openDiameter - ratio x displacement
 *
 * `displacement` is what the linear transducer measures (0 at the open
 * position); `ratio` is the mechanical conversion from ram stroke to change in
 * die diameter (config.ts -> GEOMETRY).
 */
export interface DieGeometry {
  /** mm of die-diameter change per mm of measured stroke. */
  diameterMmPerStrokeMm: number;
}

/** Only used by the UI before the real value arrives from the main process. */
export const DEFAULT_GEOMETRY: DieGeometry = { diameterMmPerStrokeMm: 1 };

export const DEFAULT_LINEAR_PARAMS: LinearCrimpParams = {
  targetDiameterMm: 32,
  correctionMm: 0.2,
  dieSizeMm: 32,
  openDiameterMm: 74,
  holdTimeSec: 1,
};

export const LINEAR_PARAM_LIMITS = {
  targetDiameterMm: { min: 5, max: 150 },
  correctionMm: { min: -2, max: 2 },
  dieSizeMm: { min: 5, max: 150 },
  openDiameterMm: { min: 20, max: 200 },
  holdTimeSec: { min: 0, max: 30 },
} as const;

const KEYS = Object.keys(LINEAR_PARAM_LIMITS) as Array<keyof LinearCrimpParams>;

export function diameterFromDisplacement(
  openDiameterMm: number,
  displacementMm: number,
  geometry: DieGeometry,
): number {
  return openDiameterMm - geometry.diameterMmPerStrokeMm * displacementMm;
}

export function displacementForDiameter(
  openDiameterMm: number,
  diameterMm: number,
  geometry: DieGeometry,
): number {
  return (openDiameterMm - diameterMm) / geometry.diameterMmPerStrokeMm;
}

/** Target after applying the correction. */
export function effectiveTargetDiameter(
  p: Pick<LinearCrimpParams, 'targetDiameterMm' | 'correctionMm'>,
): number {
  return p.targetDiameterMm + p.correctionMm;
}

/** Turns the operator's diameter parameters into the stroke the controller stops at. */
export function planLinearCrimp(
  params: LinearCrimpParams,
  geometry: DieGeometry,
): { effectiveDiameterMm: number; targetStrokeMm: number } {
  const effectiveDiameterMm = effectiveTargetDiameter(params);
  return {
    effectiveDiameterMm,
    targetStrokeMm: displacementForDiameter(params.openDiameterMm, effectiveDiameterMm, geometry),
  };
}

export type ParsedLinearParams =
  | { ok: true; params: LinearCrimpParams }
  | { ok: false; error: string };

const LABELS: Record<keyof LinearCrimpParams, string> = {
  targetDiameterMm: 'Target diameter',
  correctionMm: 'Correction',
  dieSizeMm: 'Die size',
  openDiameterMm: 'Open diameter',
  holdTimeSec: 'Hold time',
};

/** Validates untrusted input (IPC) into LinearCrimpParams. */
export function parseLinearParams(raw: unknown): ParsedLinearParams {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'Invalid linear crimp parameters' };
  }
  const source = raw as Record<string, unknown>;
  const out = {} as LinearCrimpParams;
  for (const key of KEYS) {
    const value = source[key];
    const { min, max } = LINEAR_PARAM_LIMITS[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: `${LABELS[key]} must be a number` };
    }
    if (value < min || value > max) {
      return { ok: false, error: `${LABELS[key]} must be between ${min} and ${max}` };
    }
    out[key] = value;
  }
  if (effectiveTargetDiameter(out) >= out.openDiameterMm) {
    return { ok: false, error: 'Target diameter (with correction) must be smaller than the open diameter' };
  }
  return { ok: true, params: out };
}

/** Lenient version for stored values: fills gaps from the defaults and clamps. */
export function coerceLinearParams(raw: unknown): LinearCrimpParams | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const out = { ...DEFAULT_LINEAR_PARAMS };
  for (const key of KEYS) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const { min, max } = LINEAR_PARAM_LIMITS[key];
      out[key] = Math.min(max, Math.max(min, value));
    }
  }
  return out;
}
