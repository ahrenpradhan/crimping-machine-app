import type { PieceCounters } from '../../shared/types';
import { ConfirmButton } from './ConfirmButton';

interface Props {
  counters: PieceCounters;
  onAddRejected: () => void;
  onReset: () => void;
}

/**
 * Piece counters. GOOD counts up by itself on every completed crimp; the
 * operator adds a BAD piece with "+" after measuring. RESET needs two taps.
 */
export function Counters({ counters, onAddRejected, onReset }: Props) {
  return (
    <div className="counters">
      <div className="counter counter--good">
        <span className="counter__label">Good</span>
        <span className="counter__value">{counters.good}</span>
      </div>
      <div className="counter counter--bad">
        <span className="counter__label">Bad</span>
        <span className="counter__value">{counters.bad}</span>
        <button
          type="button"
          className="counter__plus"
          onClick={onAddRejected}
          aria-label="Add one bad piece"
        >
          +
        </button>
      </div>
      <div className="counter">
        <span className="counter__label">Total</span>
        <span className="counter__value">{counters.total}</span>
      </div>
      <ConfirmButton
        className="counters__reset"
        label="RESET"
        confirmLabel="AGAIN"
        onConfirm={onReset}
      />
    </div>
  );
}
