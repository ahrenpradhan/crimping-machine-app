interface Props {
  canStart: boolean;
  fault: boolean;
  onStart: () => void;
  onStop: () => void;
}

/** STOP is never disabled. In FAULT it becomes the acknowledge button. */
export function ControlButtons({ canStart, fault, onStart, onStop }: Props) {
  return (
    <div className="controls">
      <button type="button" className="btn btn--start" disabled={!canStart} onClick={onStart}>
        START
      </button>
      <button type="button" className="btn btn--stop" onClick={onStop}>
        {fault ? 'RESET FAULT' : 'STOP'}
      </button>
    </div>
  );
}
