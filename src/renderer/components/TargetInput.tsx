import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface Props {
  label: string;
  unit: string;
  value: number;
  step: number;
  decimals: number;
  min: number;
  max: number;
  disabled?: boolean;
  /** Smaller variant for secondary parameters. */
  compact?: boolean;
  /** Main parameter of the screen: drawn with an accent label. */
  primary?: boolean;
  /** Small control shown on the label line, right-aligned (e.g. TEACH). */
  action?: ReactNode;
  onChange: (value: number) => void;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * Labelled numeric parameter with big -/+ buttons (touchscreen friendly - no
 * keyboard needed). Typing also works; the value is clamped when the field
 * loses focus.
 */
export function TargetInput({
  label,
  unit,
  value,
  step,
  decimals,
  min,
  max,
  disabled = false,
  compact = false,
  primary = false,
  action,
  onChange,
}: Props) {
  const id = useId();
  const [draft, setDraft] = useState(value.toFixed(decimals));
  const focused = useRef(false);

  // Follow external changes (the -/+ buttons, stored values) unless typing.
  useEffect(() => {
    if (!focused.current) setDraft(value.toFixed(decimals));
  }, [value, decimals]);

  const commit = (n: number): void => {
    onChange(Number(clamp(n, min, max).toFixed(decimals)));
  };

  const nudge = (direction: 1 | -1): void => commit(value + direction * step);

  return (
    <div className={`field${compact ? ' field--compact' : ''}${primary ? ' field--primary' : ''}`}>
      <div className="field__head">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        {action}
      </div>
      <div className="field__row">
        <button
          type="button"
          className="step-btn"
          disabled={disabled}
          onClick={() => nudge(-1)}
          aria-label={`Decrease ${label}`}
        >
          -
        </button>
        <div className="field__input-wrap">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={draft}
            disabled={disabled}
            onFocus={() => {
              focused.current = true;
            }}
            onBlur={() => {
              focused.current = false;
              const n = Number(draft);
              if (draft.trim() !== '' && Number.isFinite(n)) commit(n);
              setDraft(value.toFixed(decimals));
            }}
            onChange={(e) => {
              setDraft(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n);
            }}
          />
          <span className="field__unit">{unit}</span>
        </div>
        <button
          type="button"
          className="step-btn"
          disabled={disabled}
          onClick={() => nudge(1)}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}
