import type { MachineState } from '../../shared/types';
import { STATUS_LABEL, statusTone } from '../utils/status';

interface Props {
  state: MachineState | null;
  commandError: string | null;
}

/** Status badge, fault text, last-cycle result and command errors. */
export function StatusPanel({ state, commandError }: Props) {
  const status = state?.status ?? 'IDLE';
  const cycle = state?.cycle ?? null;
  const showResult = cycle !== null && cycle.result !== 'RUNNING';

  return (
    <div className="status">
      <div className="status__row">
        <span className="field-label">Status</span>
        <span className={`badge badge--${statusTone(status)}`}>{STATUS_LABEL[status]}</span>
      </div>

      {state?.faultMessage && <div className="status__fault">{state.faultMessage}</div>}
      {commandError && <div className="status__error">{commandError}</div>}

      {showResult && cycle && (
        <div className="status__result">
          <div className="status__result-title">
            Cycle #{cycle.cycleId} - {cycle.mode === 'LINEAR' ? 'by linear' : 'by pressure'}{' '}
            <em>{cycle.result}</em>
          </div>
          <div className="status__result-values">
            {cycle.finalDisplacementMm.toFixed(2)} mm | {cycle.finalPressureBar.toFixed(1)} bar |
            peak {cycle.peakPressureBar.toFixed(1)} bar | {(cycle.durationMs / 1000).toFixed(2)} s
          </div>
        </div>
      )}
    </div>
  );
}
