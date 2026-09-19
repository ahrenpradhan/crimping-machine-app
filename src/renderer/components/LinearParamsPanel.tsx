import {
  LINEAR_PARAM_LIMITS as LIMITS,
  displacementForDiameter,
  effectiveTargetDiameter,
  type DieGeometry,
} from '../../shared/linear';
import type { LinearCrimpParams } from '../../shared/types';
import { DieSetupFields } from './DieSetupFields';
import { TargetInput } from './TargetInput';

interface Props {
  params: LinearCrimpParams;
  onChange: (params: LinearCrimpParams) => void;
  geometry: DieGeometry;
  /** A LINEAR cycle is running: parameters are read-only. */
  locked: boolean;
  /** Teaching is only allowed when the machine is idle / complete. */
  canTeach: boolean;
  onTeach: () => void;
  zeroOffsetMm: number | null;
}

/**
 * CRIMP BY LINEAR parameters (as on the Uniflex screen):
 *   target Ø, correction, die size, open Ø (+ teach), hold time.
 * The operator works in diameters; the machine stops on the linear transducer.
 */
export function LinearParamsPanel({
  params,
  onChange,
  geometry,
  locked,
  canTeach,
  onTeach,
  zeroOffsetMm,
}: Props) {
  const set =
    (key: keyof LinearCrimpParams) =>
    (value: number): void =>
      onChange({ ...params, [key]: value });

  const effective = effectiveTargetDiameter(params);
  const stroke = displacementForDiameter(params.openDiameterMm, effective, geometry);
  const invalid = !(stroke > 0);

  return (
    <div className="params-grid">
      <TargetInput
        primary
        label="Target diameter"
        unit="mm"
        value={params.targetDiameterMm}
        step={0.5}
        decimals={2}
        min={LIMITS.targetDiameterMm.min}
        max={LIMITS.targetDiameterMm.max}
        disabled={locked}
        onChange={set('targetDiameterMm')}
      />

      <DieSetupFields
        die={params}
        onChange={(patch) => onChange({ ...params, ...patch })}
        locked={locked}
        canTeach={canTeach}
        onTeach={onTeach}
        zeroOffsetMm={zeroOffsetMm}
      />

      <TargetInput
        label="Correction (+ larger)"
        unit="mm"
        value={params.correctionMm}
        step={0.1}
        decimals={2}
        min={LIMITS.correctionMm.min}
        max={LIMITS.correctionMm.max}
        disabled={locked}
        onChange={set('correctionMm')}
      />

      <TargetInput
        label="Hold time"
        unit="s"
        value={params.holdTimeSec}
        step={0.5}
        decimals={1}
        min={LIMITS.holdTimeSec.min}
        max={LIMITS.holdTimeSec.max}
        disabled={locked}
        onChange={set('holdTimeSec')}
      />

      <div className={`calc params-grid__note${invalid ? ' calc--bad' : ''}`}>
        {invalid ? (
          'Target diameter must be smaller than the open diameter'
        ) : (
          <>
            Stops at <b>{effective.toFixed(2)} mm</b> diameter = <b>{stroke.toFixed(2)} mm</b> stroke
          </>
        )}
        {zeroOffsetMm !== null && Math.abs(zeroOffsetMm) > 0.005 && (
          <div className="calc__sub">Zero offset {zeroOffsetMm.toFixed(2)} mm</div>
        )}
      </div>
    </div>
  );
}
