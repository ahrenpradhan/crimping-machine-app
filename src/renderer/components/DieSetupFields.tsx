import { LINEAR_PARAM_LIMITS as LIMITS } from '../../shared/linear';
import { ConfirmButton } from './ConfirmButton';
import { TargetInput } from './TargetInput';

export interface DieSetup {
  dieSizeMm: number;
  openDiameterMm: number;
}

interface Props {
  die: DieSetup;
  onChange: (patch: Partial<DieSetup>) => void;
  locked: boolean;
  /** Teaching is only allowed when the machine is idle / complete. */
  canTeach: boolean;
  onTeach: () => void;
  zeroOffsetMm: number | null;
}

/**
 * Die size and open diameter (with the TEACH button on the label line). The
 * die is the same physical die in both crimp modes, so both mode panels use
 * these two fields in the same grid position. Renders two grid cells.
 */
export function DieSetupFields({ die, onChange, locked, canTeach, onTeach, zeroOffsetMm }: Props) {
  const offsetText =
    zeroOffsetMm !== null && Math.abs(zeroOffsetMm) > 0.005 ? ` (zero offset ${zeroOffsetMm.toFixed(2)} mm)` : '';
  return (
    <>
      <TargetInput
        label="Die size"
        unit="mm"
        value={die.dieSizeMm}
        step={1}
        decimals={0}
        min={LIMITS.dieSizeMm.min}
        max={LIMITS.dieSizeMm.max}
        disabled={locked}
        onChange={(v) => onChange({ dieSizeMm: v })}
      />
      <TargetInput
        label="Open diameter"
        unit="mm"
        value={die.openDiameterMm}
        step={1}
        decimals={2}
        min={LIMITS.openDiameterMm.min}
        max={LIMITS.openDiameterMm.max}
        disabled={locked}
        onChange={(v) => onChange({ openDiameterMm: v })}
        action={
          <ConfirmButton
            className="teach__btn"
            label="TEACH"
            confirmLabel="TAP AGAIN"
            disabled={!canTeach}
            onConfirm={onTeach}
            title={`Sets the current ram position as fully open${offsetText}`}
          />
        }
      />
    </>
  );
}
