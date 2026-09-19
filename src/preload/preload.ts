import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type MachineApi, type MachineState, type UiTick } from '../shared/types';

/**
 * Runs with contextIsolation: true and nodeIntegration: false. The renderer
 * gets ONLY this small, explicit surface as `window.machine` - no Node, no
 * ipcRenderer, no arbitrary channels.
 */
const machine: MachineApi = {
  getSensors: () => ipcRenderer.invoke(IPC.getSensors),
  getState: () => ipcRenderer.invoke(IPC.getState),
  getCycleData: () => ipcRenderer.invoke(IPC.getCycleData),
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),

  startLinearCrimp: (targetMm) => ipcRenderer.invoke(IPC.startLinear, targetMm),
  startPressureCrimp: (targetBar) => ipcRenderer.invoke(IPC.startPressure, targetBar),
  stopCrimp: () => ipcRenderer.invoke(IPC.stop),

  onTick: (callback) => {
    const listener = (_event: IpcRendererEvent, tick: UiTick): void => callback(tick);
    ipcRenderer.on(IPC.tick, listener);
    return () => {
      ipcRenderer.removeListener(IPC.tick, listener);
    };
  },
  onState: (callback) => {
    const listener = (_event: IpcRendererEvent, state: MachineState): void => callback(state);
    ipcRenderer.on(IPC.state, listener);
    return () => {
      ipcRenderer.removeListener(IPC.state, listener);
    };
  },
};

contextBridge.exposeInMainWorld('machine', machine);
