import type { CrimpMode } from '../../shared/types';

interface Props {
  mode: CrimpMode;
  value: string;
  max: number;
  disabled: boolean;
  onChange: (value: string) => void;
}

const CONFIG = {
  LINEAR: { label: 'Target displacement', unit: 'mm', step: 0.5, decimals: 2 },
  PRESSURE: { label: 'Target pressure', unit: 'bar', step: 5, decimals: 1 },
} as const;

/** Numeric target with -/+ buttons (touchscreen friendly - no keyboard needed). */
export function TargetInput({ mode, value, max, disabled, onChange }: Props) {
  const cfg = CONFIG[mode];

  const nudge = (direction: 1 | -1): void => {
    const current = Number(value) || 0;
    const next = Math.min(max, Math.max(0, current + direction * cfg.step));
    onChange(next.toFixed(cfg.decimals));
  };

  return (
    <div className="target">
      <label className="field-label" htmlFor="target-input">
        {cfg.label}
      </label>
      <div className="target__row">
        <button type="button" className="step-btn" disabled={disabled} onClick={() => nudge(-1)}>
          -
        </button>
        <div className="target__input-wrap">
          <input
            id="target-input"
            type="number"
            inputMode="decimal"
            min={0}
            max={max}
            step={cfg.step}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="target__unit">{cfg.unit}</span>
        </div>
        <button type="button" className="step-btn" disabled={disabled} onClick={() => nudge(1)}>
          +
        </button>
      </div>
    </div>
  );
}
