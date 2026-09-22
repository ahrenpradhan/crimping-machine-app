import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent, TitleComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// Tree-shaken ECharts: only what these graphs need. Canvas keeps 100 Hz data
// smooth on a Raspberry Pi.
echarts.use([LineChart, GridComponent, MarkLineComponent, TitleComponent, CanvasRenderer]);

export interface TargetLine {
  /** 'x' draws a vertical line at x = value, 'y' a horizontal line at y = value. */
  axis: 'x' | 'y';
  value: number;
  label: string;
}

export interface TraceChartProps {
  title: string;
  xName: string;
  yName: string;
  data: Array<[number, number]>;
  color: string;
  xMin: number;
  xMax: number;
  yMax: number;
  target?: TargetLine | null;
  /** Small tile: tiny fonts, no axis names (put the units in `title`). */
  compact?: boolean;
}

// ECharts draws to a <canvas>, so it can't read CSS var()s directly the way the
// rest of the UI does - these are pulled from the current theme's computed
// custom properties instead, and rebuilt whenever the theme toggles (see
// useThemeTick below).
function themeColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function buildOption(p: TraceChartProps): echarts.EChartsCoreOption {
  const small = p.compact === true;
  const labelSize = small ? 10 : 12;
  const textColor = themeColor('--text', '#e6edf7');
  const axisTextColor = themeColor('--muted', '#8a9bb4');
  const axisLineColor = themeColor('--chart-axis', '#3a4a66');
  const splitLineColor = themeColor('--chart-split', '#1b2740');
  const targetColor = themeColor('--chart-target', '#f87171');
  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: small
      ? { left: 38, right: 10, top: 24, bottom: 18 }
      : { left: 54, right: 18, top: 34, bottom: 38 },
    title: {
      text: p.title,
      left: 10,
      top: small ? 3 : 4,
      textStyle: { color: textColor, fontSize: small ? 11 : 14, fontWeight: 600 },
    },
    xAxis: {
      type: 'value',
      name: small ? '' : p.xName,
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: axisTextColor },
      min: p.xMin,
      max: p.xMax,
      axisLine: { lineStyle: { color: axisLineColor } },
      axisLabel: { color: axisTextColor, fontSize: labelSize },
      splitLine: { lineStyle: { color: splitLineColor } },
    },
    yAxis: {
      type: 'value',
      name: small ? '' : p.yName,
      nameTextStyle: { color: axisTextColor, align: 'left' },
      min: 0,
      max: p.yMax,
      axisLine: { show: true, lineStyle: { color: axisLineColor } },
      axisLabel: { color: axisTextColor, fontSize: labelSize },
      splitLine: { lineStyle: { color: splitLineColor } },
    },
    series: [
      {
        type: 'line',
        data: p.data,
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: small ? 1.5 : 2, color: p.color },
        itemStyle: { color: p.color },
        markLine: p.target
          ? {
              silent: true,
              symbol: 'none',
              animation: false,
              lineStyle: { color: targetColor, type: 'dashed', width: 1.5 },
              label: {
                color: targetColor,
                fontSize: labelSize,
                formatter: p.target.label,
                position: 'insideEndTop',
              },
              data: [p.target.axis === 'x' ? { xAxis: p.target.value } : { yAxis: p.target.value }],
            }
          : undefined,
      },
    ],
  };
}

/** Bumps on every dark/light toggle, so charts rebuild with the new theme's colors
 * even when nothing else about them changed (e.g. a finished cycle's chart, sitting
 * idle with no new samples coming in). */
function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const target = document.documentElement;
    const observer = new MutationObserver(() => setTick((t) => t + 1));
    observer.observe(target, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return tick;
}

/** Thin React wrapper around one ECharts line chart. */
export function TraceChart(props: TraceChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const themeTick = useThemeTick();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const instance = echarts.init(el, undefined, { renderer: 'canvas' });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(buildOption(props), { notMerge: true });
    // themeTick is intentionally in the deps: it forces a rebuild (with freshly
    // read CSS colors) on toggle, even though it isn't used in buildOption's body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props, themeTick]);

  return <div className="trace-chart" ref={host} />;
}
