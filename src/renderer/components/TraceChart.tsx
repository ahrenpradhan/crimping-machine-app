import { useEffect, useRef } from 'react';
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
}

const AXIS_COLOR = '#3a4a66';
const TEXT_COLOR = '#8a9bb4';
const TARGET_COLOR = '#f87171';

function buildOption(p: TraceChartProps): echarts.EChartsCoreOption {
  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 54, right: 18, top: 34, bottom: 38 },
    title: {
      text: p.title,
      left: 10,
      top: 4,
      textStyle: { color: '#c9d6ea', fontSize: 14, fontWeight: 600 },
    },
    xAxis: {
      type: 'value',
      name: p.xName,
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: TEXT_COLOR },
      min: p.xMin,
      max: p.xMax,
      axisLine: { lineStyle: { color: AXIS_COLOR } },
      axisLabel: { color: TEXT_COLOR },
      splitLine: { lineStyle: { color: '#1b2740' } },
    },
    yAxis: {
      type: 'value',
      name: p.yName,
      nameTextStyle: { color: TEXT_COLOR, align: 'left' },
      min: 0,
      max: p.yMax,
      axisLine: { show: true, lineStyle: { color: AXIS_COLOR } },
      axisLabel: { color: TEXT_COLOR },
      splitLine: { lineStyle: { color: '#1b2740' } },
    },
    series: [
      {
        type: 'line',
        data: p.data,
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: 2, color: p.color },
        itemStyle: { color: p.color },
        markLine: p.target
          ? {
              silent: true,
              symbol: 'none',
              animation: false,
              lineStyle: { color: TARGET_COLOR, type: 'dashed', width: 1.5 },
              label: {
                color: TARGET_COLOR,
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

/** Thin React wrapper around one ECharts line chart. */
export function TraceChart(props: TraceChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

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
  });

  return <div className="trace-chart" ref={host} />;
}
