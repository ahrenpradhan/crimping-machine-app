import type { CrimpMode } from '../../shared/types';

interface Props {
  mode: CrimpMode;
  disabled: boolean;
  onChange: (mode: CrimpMode) => void;
}

const MODES: CrimpMode[] = ['LINEAR', 'PRESSURE'];

/** The only two operating modes. */
export function ModeSelector({ mode, disabled, onChange }: Props) {
  return (
    <div className="mode-selector" role="radiogroup" aria-label="Crimp mode">
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          className={`mode-btn${mode === m ? ' mode-btn--active' : ''}`}
          disabled={disabled}
          onClick={() => onChange(m)}
        >
          CRIMP BY {m}
        </button>
      ))}
    </div>
  );
}
