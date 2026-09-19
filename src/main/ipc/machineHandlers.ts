import type { BrowserWindow, IpcMain } from 'electron';
import { IPC, type AppInfo, type Sample, type UiTick } from '../../shared/types';
import type { CrimpController } from '../machine/CrimpController';
import type { SensorManager } from '../sensors/SensorManager';

export interface MachineHandlerDeps {
  ipcMain: IpcMain;
  getWindow: () => BrowserWindow | null;
  controller: CrimpController;
  sensors: SensorManager;
  info: AppInfo;
}

/**
 * The ONLY place the renderer can reach machine logic (via preload's
 * `window.machine`). Handlers validate their arguments; the renderer never
 * gets Node, Modbus, or the controller itself.
 *
 * Returns a function that unregisters everything.
 */
export function registerMachineHandlers(deps: MachineHandlerDeps): () => void {
  const { ipcMain, getWindow, controller, sensors, info } = deps;

  // ---- Request / response ------------------------------------------------
  ipcMain.handle(IPC.getSensors, () => sensors.getLatestSample());
  ipcMain.handle(IPC.getState, () => controller.getState());
  ipcMain.handle(IPC.getAppInfo, () => info);
  ipcMain.handle(IPC.getCycleData, () => ({
    cycleId: controller.getCycleId(),
    samples: controller.getCycleSamples(),
  }));

  ipcMain.handle(IPC.startLinear, (_event, target: unknown) =>
    typeof target === 'number'
      ? controller.startLinearCrimp(target)
      : { ok: false, error: 'Invalid target' },
  );
  ipcMain.handle(IPC.startPressure, (_event, target: unknown) =>
    typeof target === 'number'
      ? controller.startPressureCrimp(target)
      : { ok: false, error: 'Invalid target' },
  );
  ipcMain.handle(IPC.stop, () => controller.stopCrimp());

  // ---- Push to the UI at 10-20 Hz (batched) ------------------------------
  // Acquisition runs at 100 Hz; the UI only ever gets ~15 batched updates/s.
  const pending: Sample[] = [];
  const onSample = (sample: Sample): void => {
    pending.push(sample);
    if (pending.length > 1000) pending.splice(0, pending.length - 1000);
  };
  sensors.on('sample', onSample);

  let sentCycleId = 0;
  let sentCount = 0;

  const pushTick = (): void => {
    const win = getWindow();
    if (!win || win.isDestroyed()) {
      pending.length = 0;
      return;
    }
    const cycleId = controller.getCycleId();
    if (cycleId !== sentCycleId) {
      sentCycleId = cycleId;
      sentCount = 0;
    }
    const cycleSamples = controller.getCycleSamplesFrom(sentCount);
    const tick: UiTick = {
      sample: sensors.getLatestSample(),
      sensorStatus: sensors.getStatus(),
      state: controller.getState(),
      samples: pending.splice(0, pending.length),
      cycle: { cycleId, fromIndex: sentCount, samples: cycleSamples },
    };
    sentCount += cycleSamples.length;
    win.webContents.send(IPC.tick, tick);
  };
  const timer = setInterval(pushTick, Math.round(1000 / info.uiRateHz));

  // State transitions are pushed immediately so short-lived states
  // (TARGET_*_REACHED) are never missed between UI ticks.
  const unsubscribeState = controller.onStateChange((state) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC.state, state);
  });

  return () => {
    clearInterval(timer);
    unsubscribeState();
    sensors.removeListener('sample', onSample);
    for (const channel of [
      IPC.getSensors,
      IPC.getState,
      IPC.getAppInfo,
      IPC.getCycleData,
      IPC.startLinear,
      IPC.startPressure,
      IPC.stop,
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
}
