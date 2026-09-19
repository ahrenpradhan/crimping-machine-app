import type { MachineState } from '../../shared/types';
import { STATUS_LABEL, statusTone } from '../utils/status';

interface Props {
  state: MachineState | null;
  commandError: string | null;
}

/** Status badge, cycle time, fault text, last-cycle result and command errors. */
export function StatusPanel({ state, commandError }: Props) {
  const status = state?.status ?? 'IDLE';
  const cycle = state?.cycle ?? null;
  const showResult = cycle !== null && cycle.result !== 'RUNNING';
  const elapsed = (state?.elapsedMs ?? 0) / 1000;

  return (
    <div className="status">
      <div className="status__row">
        <span className={`badge badge--${statusTone(status)}`}>{STATUS_LABEL[status]}</span>
        <span className="status__time">{elapsed.toFixed(2)} s</span>
      </div>

      {/* One message line only: a fault outranks a rejected command (which would just repeat "fault active"). */}
      {state?.faultMessage ? (
        <div className="status__fault" title={state.faultMessage}>
          {state.faultMessage}
        </div>
      ) : (
        commandError && (
          <div className="status__error" title={commandError}>
            {commandError}
          </div>
        )
      )}

      {showResult && cycle && (
        <div className="status__result">
          <div className="status__result-title">
            Last crimp #{cycle.cycleId} - {cycle.mode === 'LINEAR' ? 'by linear' : 'by pressure'}{' '}
            <em>{cycle.result}</em>
            {cycle.withinTolerance === false && (
              <span className="status__oot">OUT OF TOLERANCE - counted as bad</span>
            )}
          </div>
          <div className="status__result-values">
            {cycle.finalDiameterMm !== null && <>Die {cycle.finalDiameterMm.toFixed(2)} mm | </>}
            {cycle.finalDisplacementMm.toFixed(2)} mm | {cycle.finalPressureBar.toFixed(1)} bar |
            peak {cycle.peakPressureBar.toFixed(1)} bar | {(cycle.durationMs / 1000).toFixed(2)} s
          </div>
        </div>
      )}
    </div>
  );
}
