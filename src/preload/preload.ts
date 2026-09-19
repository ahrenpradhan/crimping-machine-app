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

  startLinearCrimp: (params, context) => ipcRenderer.invoke(IPC.startLinear, params, context),
  startPressureCrimp: (params, context) => ipcRenderer.invoke(IPC.startPressure, params, context),
  stopCrimp: () => ipcRenderer.invoke(IPC.stop),
  addRejected: () => ipcRenderer.invoke(IPC.addRejected),
  resetCounters: () => ipcRenderer.invoke(IPC.resetCounters),
  teachOpenPosition: () => ipcRenderer.invoke(IPC.teachOpen),

  listProfiles: () => ipcRenderer.invoke(IPC.listProfiles),
  createProfile: (name) => ipcRenderer.invoke(IPC.createProfile, name),
  listRecipes: (profileId) => ipcRenderer.invoke(IPC.listRecipes, profileId),
  saveRecipe: (recipe) => ipcRenderer.invoke(IPC.saveRecipe, recipe),
  deleteRecipe: (id) => ipcRenderer.invoke(IPC.deleteRecipe, id),
  importRecipes: (recipes) => ipcRenderer.invoke(IPC.importRecipes, recipes),
  recipeStats: (profileId) => ipcRenderer.invoke(IPC.recipeStats, profileId),
  listCycles: (query) => ipcRenderer.invoke(IPC.listCycles, query),
  getCycleSamples: (id) => ipcRenderer.invoke(IPC.getCycleSamples, id),

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
