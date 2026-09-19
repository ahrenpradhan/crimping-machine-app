import { useMemo, useState } from 'react';
import {
  DEFAULT_RECIPE_TOLERANCE_MM,
  MAX_RECIPE_NAME_LENGTH,
  RECIPE_TOLERANCE_LIMITS,
  defaultRecipeName,
  planRecipeFromLinearCycle,
  type Recipe,
} from '../../shared/recipe';
import type { CycleSummary } from '../../shared/types';
import { TargetInput } from './TargetInput';

interface Props {
  cycle: CycleSummary;
  profileId: string;
  onSave: (recipe: Recipe) => void;
  onCancel: () => void;
}

/**
 * "Save as recipe" after a linear crimp: name + accepted diameter tolerance,
 * with a live preview of the pressure-mode parameters that will be stored.
 */
export function SaveRecipeDialog({ cycle, profileId, onSave, onCancel }: Props) {
  const [name, setName] = useState(() => defaultRecipeName(cycle));
  const [tolerance, setTolerance] = useState(DEFAULT_RECIPE_TOLERANCE_MM);

  const planned = useMemo(
    () =>
      planRecipeFromLinearCycle(cycle, {
        name,
        toleranceMm: tolerance,
        profileId,
        id: crypto.randomUUID(),
        now: Date.now(),
      }),
    [cycle, name, tolerance, profileId],
  );

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Save as recipe">
      <div className="modal__card">
        <h3>Save as recipe</h3>

        <label className="field-label" htmlFor="recipe-name">
          Recipe name
        </label>
        <input
          id="recipe-name"
          className="text-input"
          type="text"
          value={name}
          maxLength={MAX_RECIPE_NAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
        />

        <TargetInput
          compact
          label="Accepted diameter tolerance (+/-)"
          unit="mm"
          value={tolerance}
          step={0.1}
          decimals={2}
          min={RECIPE_TOLERANCE_LIMITS.min}
          max={RECIPE_TOLERANCE_LIMITS.max}
          onChange={setTolerance}
        />

        <div className={`calc${planned.ok ? '' : ' calc--bad'}`}>
          {planned.ok ? (
            <>
              Pressure mode will crimp to <b>{planned.recipe.pressure.targetPressureBar.toFixed(1)} bar</b>{' '}
              and accept <b>{planned.recipe.pressure.minDiameterMm.toFixed(2)} -{' '}
              {planned.recipe.pressure.maxDiameterMm.toFixed(2)} mm</b>. Slow down at{' '}
              {planned.recipe.pressure.slowSwitchDiameterMm.toFixed(1)} mm or{' '}
              {planned.recipe.pressure.slowSwitchPressureBar} bar, hold{' '}
              {planned.recipe.pressure.holdTimeSec.toFixed(1)} s.
            </>
          ) : (
            planned.error
          )}
        </div>

        <div className="modal__actions">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            CANCEL
          </button>
          <button
            type="button"
            className="btn btn--start modal__save"
            disabled={!planned.ok}
            onClick={() => planned.ok && onSave(planned.recipe)}
          >
            SAVE RECIPE
          </button>
        </div>
      </div>
    </div>
  );
}
