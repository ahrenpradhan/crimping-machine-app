import { useMemo } from 'react';
import type { MachineView } from '../hooks/useMachine';
import { LIVE_WINDOW_MS } from '../hooks/useMachine';
import { TraceChart, type TargetLine } from './TraceChart';

export type ChartSource = 'cycle' | 'live';

interface Props {
  view: MachineView;
  source: ChartSource;
  onSourceChange: (source: ChartSource) => void;
}

const PRESSURE_COLOR = '#f59e0b';
const DISPLACEMENT_COLOR = '#22d3ee';
const CURVE_COLOR = '#a3e635';

const ceilTo = (value: number, step: number): number => Math.ceil(value / step) * step;

interface Series {
  pressureTime: Array<[number, number]>;
  displacementTime: Array<[number, number]>;
  pressureDisplacement: Array<[number, number]>;
  maxPressure: number;
  maxDisplacement: number;
  maxTime: number;
}

/**
 * Three graphs, always shown together:
 *   Pressure vs Time, Displacement vs Time, Pressure vs Displacement.
 * After a cycle ends its curves stay on screen (until the next START) - the
 * pressure-vs-displacement curve in particular. "LIVE" switches to the last 10 s.
 */
export function ChartsPanel({ view, source, onSourceChange }: Props) {
  const showCycle = source === 'cycle' && view.cycleId > 0;
  const { state } = view;

  const series = useMemo<Series>(() => {
    const pt: Array<[number, number]> = [];
    const dt: Array<[number, number]> = [];
    const pd: Array<[number, number]> = [];
    let maxP = 0;
    let maxD = 0;
    let maxT = 0;

    const src = showCycle ? view.cycleSamples : view.liveSamples;
    const origin = src.length > 0 ? src[src.length - 1].timestamp : 0;
    for (const s of src) {
      // Cycle: seconds since start. Live: seconds relative to "now" (-10 .. 0).
      const t = (showCycle ? s.timestamp : s.timestamp - origin) / 1000;
      pt.push([t, s.pressureBar]);
      dt.push([t, s.displacementMm]);
      pd.push([s.displacementMm, s.pressureBar]);
      if (s.pressureBar > maxP) maxP = s.pressureBar;
      if (s.displacementMm > maxD) maxD = s.displacementMm;
      if (t > maxT) maxT = t;
    }
    return {
      pressureTime: pt,
      displacementTime: dt,
      pressureDisplacement: pd,
      maxPressure: maxP,
      maxDisplacement: maxD,
      maxTime: maxT,
    };
    // `version` changes whenever the (mutated-in-place) buffers change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.version, showCycle]);

  // Target markers only make sense for the cycle that has a target.
  const mode = showCycle ? state?.mode : null;
  const target = showCycle ? state?.target ?? null : null;
  const pressureTarget = mode === 'PRESSURE' && target !== null ? target : null;
  const displacementTarget = mode === 'LINEAR' && target !== null ? target : null;

  const line = (
    axis: 'x' | 'y',
    value: number | null,
    unit: string,
  ): TargetLine | null =>
    value === null ? null : { axis, value, label: `Target ${value} ${unit}` };

  const xMin = showCycle ? 0 : -LIVE_WINDOW_MS / 1000;
  const xMax = showCycle ? Math.max(3, Math.ceil(series.maxTime)) : 0;
  const yMaxP = ceilTo(Math.max(series.maxPressure, pressureTarget ?? 0, 100) * 1.05, 50);
  const yMaxD = ceilTo(Math.max(series.maxDisplacement, displacementTarget ?? 0, 10) * 1.05, 5);
  const xMaxD = ceilTo(Math.max(series.maxDisplacement, displacementTarget ?? 0, 10) * 1.05, 5);

  const cycleLabel = view.cycleId > 0 ? `Cycle #${view.cycleId}` : 'No cycle yet';

  return (
    <section className="charts">
      <div className="charts__header">
        <span className="charts__title">
          {showCycle ? cycleLabel : 'Live - last 10 s'}
        </span>
        <div className="charts__toggle" role="group" aria-label="Graph source">
          <button
            type="button"
            className={source === 'cycle' ? 'is-active' : ''}
            onClick={() => onSourceChange('cycle')}
          >
            CYCLE
          </button>
          <button
            type="button"
            className={source === 'live' ? 'is-active' : ''}
            onClick={() => onSourceChange('live')}
          >
            LIVE
          </button>
        </div>
      </div>

      <div className="charts__grid">
        <div className="charts__cell charts__cell--wide">
          <TraceChart
            title="Pressure vs Displacement"
            xName="Displacement (mm)"
            yName="bar"
            data={series.pressureDisplacement}
            color={CURVE_COLOR}
            xMin={0}
            xMax={xMaxD}
            yMax={yMaxP}
            target={
              displacementTarget !== null
                ? line('x', displacementTarget, 'mm')
                : line('y', pressureTarget, 'bar')
            }
          />
        </div>
        <div className="charts__cell">
          <TraceChart
            title="Pressure vs Time"
            xName="Time (s)"
            yName="bar"
            data={series.pressureTime}
            color={PRESSURE_COLOR}
            xMin={xMin}
            xMax={xMax}
            yMax={yMaxP}
            target={line('y', pressureTarget, 'bar')}
          />
        </div>
        <div className="charts__cell">
          <TraceChart
            title="Displacement vs Time"
            xName="Time (s)"
            yName="mm"
            data={series.displacementTime}
            color={DISPLACEMENT_COLOR}
            xMin={xMin}
            xMax={xMax}
            yMax={yMaxD}
            target={line('y', displacementTarget, 'mm')}
          />
        </div>
      </div>
    </section>
  );
}
