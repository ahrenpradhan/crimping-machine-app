import { LINEAR_PARAM_LIMITS } from '../../shared/linear';
import { PRESSURE_PARAM_LIMITS as LIMITS } from '../../shared/pressure';
import type { PressureCrimpParams } from '../../shared/types';
import { DieSetupFields, type DieSetup } from './DieSetupFields';
import { TargetInput } from './TargetInput';

interface Props {
  params: PressureCrimpParams;
  onChange: (params: PressureCrimpParams) => void;
  /** Die size / open diameter are shared with the linear mode. */
  onDieChange: (patch: Partial<DieSetup>) => void;
  /** Highest target the machine accepts (from the main process). */
  maxTargetBar: number;
  /** A PRESSURE cycle is running: parameters are read-only. */
  locked: boolean;
  canTeach: boolean;
  onTeach: () => void;
  zeroOffsetMm: number | null;
}

/**
 * CRIMP BY PRESSURE parameters (as on the Uniflex pressure screen):
 *   target pressure, die size, open Ø (+ teach), hold time,
 *   slow-down point (Ø / P) and the accepted final-Ø window (min / max).
 */
export function PressureParamsPanel({
  params,
  onChange,
  onDieChange,
  maxTargetBar,
  locked,
  canTeach,
  onTeach,
  zeroOffsetMm,
}: Props) {
  const set =
    (key: keyof PressureCrimpParams) =>
    (value: number): void =>
      onChange({ ...params, [key]: value });

  const windowInvalid = params.minDiameterMm >= params.maxDiameterMm;

  return (
    <div className="params-grid">
      <TargetInput
        primary
        label="Target pressure"
        unit="bar"
        value={params.targetPressureBar}
        step={5}
        decimals={1}
        min={LIMITS.targetPressureBar.min}
        max={Math.min(maxTargetBar, LIMITS.targetPressureBar.max)}
        disabled={locked}
        onChange={set('targetPressureBar')}
      />

      <DieSetupFields
        die={params}
        onChange={onDieChange}
        locked={locked}
        canTeach={canTeach}
        onTeach={onTeach}
        zeroOffsetMm={zeroOffsetMm}
      />

      <TargetInput
        label="Slow down at diameter"
        unit="mm"
        value={params.slowSwitchDiameterMm}
        step={0.5}
        decimals={1}
        min={LIMITS.slowSwitchDiameterMm.min}
        max={LIMITS.slowSwitchDiameterMm.max}
        disabled={locked}
        onChange={set('slowSwitchDiameterMm')}
      />
      <TargetInput
        label="Or slow down at pressure"
        unit="bar"
        value={params.slowSwitchPressureBar}
        step={5}
        decimals={0}
        min={LIMITS.slowSwitchPressureBar.min}
        max={LIMITS.slowSwitchPressureBar.max}
        disabled={locked}
        onChange={set('slowSwitchPressureBar')}
      />
      <TargetInput
        label="Hold time"
        unit="s"
        value={params.holdTimeSec}
        step={0.5}
        decimals={1}
        min={LINEAR_PARAM_LIMITS.holdTimeSec.min}
        max={LINEAR_PARAM_LIMITS.holdTimeSec.max}
        disabled={locked}
        onChange={set('holdTimeSec')}
      />

      <TargetInput
        label="Accepted min diameter"
        unit="mm"
        value={params.minDiameterMm}
        step={0.1}
        decimals={1}
        min={LIMITS.minDiameterMm.min}
        max={LIMITS.minDiameterMm.max}
        disabled={locked}
        onChange={set('minDiameterMm')}
      />
      <TargetInput
        label="Accepted max diameter"
        unit="mm"
        value={params.maxDiameterMm}
        step={0.1}
        decimals={1}
        min={LIMITS.maxDiameterMm.min}
        max={LIMITS.maxDiameterMm.max}
        disabled={locked}
        onChange={set('maxDiameterMm')}
      />
      <div className={`calc params-grid__note${windowInvalid ? ' calc--bad' : ''}`}>
        {windowInvalid ? (
          'Minimum must be smaller than maximum'
        ) : (
          <>
            A crimp ending outside <b>{params.minDiameterMm.toFixed(1)}</b> -{' '}
            <b>{params.maxDiameterMm.toFixed(1)} mm</b> counts as Bad. Slow-down: whichever comes first.
          </>
        )}
        {zeroOffsetMm !== null && Math.abs(zeroOffsetMm) > 0.005 && (
          <div className="calc__sub">Zero offset {zeroOffsetMm.toFixed(2)} mm</div>
        )}
      </div>
    </div>
  );
}
