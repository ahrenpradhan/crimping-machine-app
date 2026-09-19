import { useEffect, useState } from 'react';
import type { CrimpMode } from '../shared/types';
import { ChartsPanel, type ChartSource } from './components/ChartsPanel';
import { ControlButtons } from './components/ControlButtons';
import { Header } from './components/Header';
import { ModeSelector } from './components/ModeSelector';
import { Readouts } from './components/Readouts';
import { StatusPanel } from './components/StatusPanel';
import { TargetInput } from './components/TargetInput';
import { useMachine } from './hooks/useMachine';
import { isBusyStatus } from './utils/status';

/**
 * Intentionally minimal UI: it only issues commands (window.machine.*) and
 * displays the machine state. All machine logic lives in the main process.
 */
export default function App() {
  const machine = useMachine();
  const [mode, setMode] = useState<CrimpMode>('LINEAR');
  // One remembered target per mode.
  const [targets, setTargets] = useState<Record<CrimpMode, string>>({
    LINEAR: '25.00',
    PRESSURE: '320.0',
  });
  const [commandError, setCommandError] = useState<string | null>(null);
  const [chartSource, setChartSource] = useState<ChartSource>('cycle');

  const status = machine.state?.status ?? 'IDLE';
  const busy = isBusyStatus(status);
  const sensorsOk = machine.sensorStatus?.health === 'OK';
  const canStart = !busy && status !== 'FAULT' && sensorsOk;

  // A new cycle always brings the graphs back to the cycle view.
  useEffect(() => {
    if (machine.cycleId > 0) setChartSource('cycle');
  }, [machine.cycleId]);

  // If the window was reloaded mid-cycle, follow the running mode.
  const runningMode = machine.state?.mode ?? null;
  useEffect(() => {
    if (busy && runningMode) setMode(runningMode);
  }, [busy, runningMode]);

  const maxTarget =
    mode === 'LINEAR'
      ? (machine.info?.limits.maxTargetDisplacementMm ?? 45)
      : (machine.info?.limits.maxTargetPressureBar ?? 400);

  const handleStart = async (): Promise<void> => {
    setCommandError(null);
    const target = Number(targets[mode]);
    if (!Number.isFinite(target) || target <= 0) {
      setCommandError('Enter a target greater than 0');
      return;
    }
    const result =
      mode === 'LINEAR'
        ? await window.machine.startLinearCrimp(target)
        : await window.machine.startPressureCrimp(target);
    if (!result.ok) setCommandError(result.error ?? 'Start was rejected');
  };

  const handleStop = async (): Promise<void> => {
    setCommandError(null);
    await window.machine.stopCrimp();
  };

  return (
    <div className="app">
      <Header info={machine.info} sensors={machine.sensorStatus} />

      <main className="main">
        <aside className="panel">
          <ModeSelector mode={mode} disabled={busy} onChange={setMode} />

          <TargetInput
            mode={mode}
            value={targets[mode]}
            max={maxTarget}
            disabled={busy}
            onChange={(value) => setTargets((t) => ({ ...t, [mode]: value }))}
          />

          <Readouts
            sample={machine.sample}
            elapsedMs={machine.state?.elapsedMs ?? 0}
            running={busy}
          />

          <StatusPanel state={machine.state} commandError={commandError} />

          <ControlButtons
            canStart={canStart}
            fault={status === 'FAULT'}
            onStart={() => void handleStart()}
            onStop={() => void handleStop()}
          />

          <p className="disclaimer">
            Prototype only - not a safety system. Emergency stop must be hard-wired.
          </p>
        </aside>

        <ChartsPanel view={machine} source={chartSource} onSourceChange={setChartSource} />
      </main>
    </div>
  );
}
