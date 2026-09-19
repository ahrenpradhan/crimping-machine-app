import { useEffect, useRef, useState } from 'react';
import type {
  AppInfo,
  CycleSample,
  MachineState,
  Sample,
  SensorStatus,
  UiTick,
} from '../../shared/types';

/** Rolling window shown by the live (non-cycle) graphs. */
export const LIVE_WINDOW_MS = 10_000;

export interface MachineView {
  info: AppInfo | null;
  sample: Sample | null;
  sensorStatus: SensorStatus | null;
  state: MachineState | null;
  /**
   * Buffers are mutated in place for speed. `version` changes on every
   * update - use it as the dependency when deriving data from them.
   */
  liveSamples: Sample[];
  cycleSamples: CycleSample[];
  cycleId: number;
  version: number;
}

/**
 * Subscribes to the main process. It receives batched updates (~15 Hz) and
 * keeps two buffers:
 *   - a rolling live window (last 10 s) for the idle graphs
 *   - the current/last crimp cycle (kept after the cycle ends)
 * No machine logic lives here; the renderer only displays what main sends.
 */
export function useMachine(): MachineView {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [tick, setTick] = useState<UiTick | null>(null);
  const [state, setState] = useState<MachineState | null>(null);
  const [version, setVersion] = useState(0);

  const live = useRef<Sample[]>([]);
  const cycle = useRef<{ id: number; samples: CycleSample[] }>({ id: 0, samples: [] });
  const resyncing = useRef(false);

  useEffect(() => {
    let alive = true;

    void window.machine.getAppInfo().then((i) => alive && setInfo(i));
    void window.machine.getState().then((s) => alive && setState(s));

    const offState = window.machine.onState((s) => setState(s));

    const offTick = window.machine.onTick((t) => {
      // ---- live rolling window ----
      const buf = live.current;
      for (const s of t.samples) buf.push(s);
      if (buf.length > 0) {
        const cutoff = buf[buf.length - 1].timestamp - LIVE_WINDOW_MS;
        let drop = 0;
        while (drop < buf.length && buf[drop].timestamp < cutoff) drop++;
        if (drop > 0) buf.splice(0, drop);
      }

      // ---- cycle buffer (delta sync with gap detection) ----
      const c = cycle.current;
      if (t.cycle.cycleId !== c.id) {
        c.id = t.cycle.cycleId;
        c.samples = [];
      }
      if (t.cycle.cycleId > 0) {
        if (t.cycle.fromIndex <= c.samples.length) {
          c.samples.length = t.cycle.fromIndex;
          for (const s of t.cycle.samples) c.samples.push(s);
        } else if (!resyncing.current) {
          // Missed part of the cycle (e.g. window reloaded) -> fetch it all.
          resyncing.current = true;
          void window.machine
            .getCycleData()
            .then((d) => {
              cycle.current = { id: d.cycleId, samples: d.samples };
            })
            .finally(() => {
              resyncing.current = false;
            });
        }
      }

      setTick(t);
      setState(t.state);
      setVersion((v) => v + 1);
    });

    return () => {
      alive = false;
      offState();
      offTick();
    };
  }, []);

  return {
    info,
    sample: tick?.sample ?? null,
    sensorStatus: tick?.sensorStatus ?? null,
    state,
    liveSamples: live.current,
    cycleSamples: cycle.current.samples,
    cycleId: cycle.current.id,
    version,
  };
}
