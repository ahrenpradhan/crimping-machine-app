import type { Sample } from '../../shared/types';

interface Props {
  sample: Sample | null;
  elapsedMs: number;
  running: boolean;
}

/** Live values of BOTH transducers, whichever mode is selected. */
export function Readouts({ sample, elapsedMs, running }: Props) {
  return (
    <div className="readouts">
      <div className="readout">
        <span className="readout__label">Displacement</span>
        <span className="readout__value readout__value--disp">
          {sample ? sample.displacementMm.toFixed(2) : '--'}
          <small>mm</small>
        </span>
      </div>
      <div className="readout">
        <span className="readout__label">Pressure</span>
        <span className="readout__value readout__value--press">
          {sample ? sample.pressureBar.toFixed(1) : '--'}
          <small>bar</small>
        </span>
      </div>
      <div className="readout readout--time">
        <span className="readout__label">Cycle time</span>
        <span className={`readout__time${running ? ' is-running' : ''}`}>
          {(elapsedMs / 1000).toFixed(2)} s
        </span>
      </div>
    </div>
  );
}
