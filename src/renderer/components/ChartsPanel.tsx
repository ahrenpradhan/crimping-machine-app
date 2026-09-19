import { useEffect, useMemo, useState } from 'react';
import type { MachineView } from '../hooks/useMachine';
import { LIVE_WINDOW_MS } from '../hooks/useMachine';
import { TraceChart, type TargetLine, type TraceChartProps } from './TraceChart';

export type ChartSource = 'cycle' | 'live';

interface Props {
  view: MachineView;
  source: ChartSource;
  onSourceChange: (source: ChartSource) => void;
  /** When on, every START switches the graphs back to the cycle view; when off they stay as the operator left them. */
  autoCycle: boolean;
  onAutoCycleChange: (on: boolean) => void;
  /** 'column': narrow strip beside the parameters. 'row': three tiles side by side (small screens). */
  layout?: 'column' | 'row';
}

type ChartId = 'pd' | 'pt' | 'dt';
const CHART_ORDER: ChartId[] = ['pd', 'pt', 'dt'];
const CHART_TAB: Record<ChartId, string> = {
  pd: 'Pressure / Displacement',
  pt: 'Pressure / Time',
  dt: 'Displacement / Time',
};

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

interface SourceToggleProps {
  source: ChartSource;
  onChange: (source: ChartSource) => void;
}

function SourceToggle({ source, onChange }: SourceToggleProps) {
  return (
    <div className="charts__toggle" role="group" aria-label="Graph source">
      <button type="button" className={source === 'cycle' ? 'is-active' : ''} onClick={() => onChange('cycle')}>
        CYCLE
      </button>
      <button type="button" className={source === 'live' ? 'is-active' : ''} onClick={() => onChange('live')}>
        LIVE
      </button>
    </div>
  );
}

interface AutoSwitchProps {
  on: boolean;
  onChange: (on: boolean) => void;
}

/** Switch: while ON, every START jumps the graphs to the cycle view. */
function AutoSwitch({ on, onChange }: AutoSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`auto-switch${on ? ' is-on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span className="auto-switch__track" aria-hidden="true">
        <span className="auto-switch__thumb" />
      </span>
      <span className="auto-switch__text">Auto-switch to cycle view on START</span>
    </button>
  );
}

/**
 * Three graphs: Pressure vs Displacement, Pressure vs Time, Displacement vs Time.
 * They are small tiles - tap one to open it full screen. After a cycle ends its
 * curves stay on screen (until the next START); "LIVE" shows the last 10 s.
 */
export function ChartsPanel({
  view,
  source,
  onSourceChange,
  autoCycle,
  onAutoCycleChange,
  layout = 'column',
}: Props) {
  const showCycle = source === 'cycle' && view.cycleId > 0;
  const { state } = view;
  const [expanded, setExpanded] = useState<ChartId | null>(null);

  useEffect(() => {
    if (expanded === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setExpanded(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

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

  const line = (axis: 'x' | 'y', value: number | null, unit: string): TargetLine | null =>
    value === null ? null : { axis, value, label: `Target ${value} ${unit}` };

  const xMin = showCycle ? 0 : -LIVE_WINDOW_MS / 1000;
  const xMax = showCycle ? Math.max(3, Math.ceil(series.maxTime)) : 0;
  const yMaxP = ceilTo(Math.max(series.maxPressure, pressureTarget ?? 0, 100) * 1.05, 50);
  const yMaxD = ceilTo(Math.max(series.maxDisplacement, displacementTarget ?? 0, 10) * 1.05, 5);
  const xMaxD = ceilTo(Math.max(series.maxDisplacement, displacementTarget ?? 0, 10) * 1.05, 5);

  const cycleLabel = view.cycleId > 0 ? `Cycle #${view.cycleId}` : 'No cycle yet';
  const heading = showCycle ? cycleLabel : 'Live - last 10 s';

  /** Everything one chart needs; `compact` = the small tile. */
  const chartProps = (id: ChartId, compact: boolean): TraceChartProps => {
    switch (id) {
      case 'pd':
        return {
          title: compact ? 'Pressure (bar) vs Displacement (mm)' : 'Pressure vs Displacement',
          xName: 'Displacement (mm)',
          yName: 'bar',
          data: series.pressureDisplacement,
          color: CURVE_COLOR,
          xMin: 0,
          xMax: xMaxD,
          yMax: yMaxP,
          target:
            displacementTarget !== null
              ? line('x', displacementTarget, 'mm')
              : line('y', pressureTarget, 'bar'),
          compact,
        };
      case 'pt':
        return {
          title: compact ? 'Pressure (bar) vs Time (s)' : 'Pressure vs Time',
          xName: 'Time (s)',
          yName: 'bar',
          data: series.pressureTime,
          color: PRESSURE_COLOR,
          xMin,
          xMax,
          yMax: yMaxP,
          target: line('y', pressureTarget, 'bar'),
          compact,
        };
      case 'dt':
        return {
          title: compact ? 'Displacement (mm) vs Time (s)' : 'Displacement vs Time',
          xName: 'Time (s)',
          yName: 'mm',
          data: series.displacementTime,
          color: DISPLACEMENT_COLOR,
          xMin,
          xMax,
          yMax: yMaxD,
          target: line('y', displacementTarget, 'mm'),
          compact,
        };
    }
  };

  return (
    <section className={`charts${layout === 'row' ? ' charts--row' : ''}`}>
      <div className="charts__header">
        <span className="charts__title">{heading}</span>
        {layout === 'row' && <AutoSwitch on={autoCycle} onChange={onAutoCycleChange} />}
        <SourceToggle source={source} onChange={onSourceChange} />
      </div>
      {layout !== 'row' && (
        <div className="charts__auto">
          <AutoSwitch on={autoCycle} onChange={onAutoCycleChange} />
        </div>
      )}

      <div className="charts__grid">
        {CHART_ORDER.map((id) => (
          <div
            key={id}
            className="charts__cell"
            role="button"
            tabIndex={0}
            aria-label={`Expand graph: ${CHART_TAB[id]}`}
            onClick={() => setExpanded(id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setExpanded(id);
            }}
          >
            <TraceChart {...chartProps(id, true)} />
            <span className="charts__expand" aria-hidden="true">
              &#x2922;
            </span>
          </div>
        ))}
      </div>

      {expanded !== null && (
        <div className="charts-full" role="dialog" aria-modal="true" aria-label="Graph">
          <div className="charts-full__bar">
            <div className="charts__toggle" role="tablist" aria-label="Graph">
              {CHART_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={expanded === id}
                  className={expanded === id ? 'is-active' : ''}
                  onClick={() => setExpanded(id)}
                >
                  {CHART_TAB[id].toUpperCase()}
                </button>
              ))}
            </div>
            <span className="charts__title charts-full__heading">{heading}</span>
            <SourceToggle source={source} onChange={onSourceChange} />
            <AutoSwitch on={autoCycle} onChange={onAutoCycleChange} />
            <button type="button" className="ghost-btn charts-full__close" onClick={() => setExpanded(null)}>
              CLOSE
            </button>
          </div>
          <div className="charts-full__body">
            <TraceChart {...chartProps(expanded, false)} />
          </div>
        </div>
      )}
    </section>
  );
}
