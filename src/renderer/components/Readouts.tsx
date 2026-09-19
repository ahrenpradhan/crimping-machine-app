import type { Sample } from '../../shared/types';

interface Props {
  sample: Sample | null;
  /** Current die diameter (from the linear transducer and the open diameter). */
  diameterMm: number | null;
}

/** Live values of BOTH transducers (plus the derived die diameter), whichever mode is selected. */
export function Readouts({ sample, diameterMm }: Props) {
  return (
    <>
      <div className="readout">
        <span className="readout__label">Die diameter</span>
        <span className="readout__value readout__value--dia">
          {diameterMm !== null ? diameterMm.toFixed(2) : '--'}
          <small>mm</small>
        </span>
      </div>
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
    </>
  );
}
