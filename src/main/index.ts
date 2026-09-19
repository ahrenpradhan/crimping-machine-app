import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import type { AppInfo } from '../shared/types';
import { ACQUISITION, LIMITS, SERIAL, SIMULATION, TIMING } from './config';
import { registerMachineHandlers } from './ipc/machineHandlers';
import { CrimpController } from './machine/CrimpController';
import { LogMachineOutput, SimulatedMachineOutput, type MachineOutput } from './machine/MachineOutput';
import { ModbusClient, type IModbusClient } from './modbus/ModbusClient';
import { SensorManager } from './sensors/SensorManager';
import { SimulatedModbusClient } from './simulation/SimulatedModbusClient';
import { SimulatedPlant } from './simulation/SimulatedPlant';

let mainWindow: BrowserWindow | null = null;
let teardown: (() => void) | null = null;

function createWindow(): void {
  const kiosk = process.env.CRIMP_KIOSK === '1';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 580,
    show: false,
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    fullscreen: kiosk,
    kiosk,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  if (process.env.CRIMP_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

/** Wire the machine together. Simulation and hardware differ only in these three objects. */
function startMachine(): void {
  const plant = SIMULATION ? new SimulatedPlant() : null;
  const client: IModbusClient = plant ? new SimulatedModbusClient(plant) : new ModbusClient();
  // v1: outputs are simulated or log-only. No physical switch/solenoid control.
  const output: MachineOutput = plant ? new SimulatedMachineOutput(plant) : new LogMachineOutput();

  const sensors = new SensorManager(client, {
    sampleRateHz: TIMING.sampleRateHz,
    maxConsecutiveErrors: ACQUISITION.maxConsecutiveErrors,
    reconnectIntervalMs: ACQUISITION.reconnectIntervalMs,
  });
  const controller = new CrimpController(sensors, output, LIMITS);

  const info: AppInfo = {
    simulation: SIMULATION,
    sampleRateHz: TIMING.sampleRateHz,
    uiRateHz: TIMING.uiRateHz,
    limits: {
      maxTargetDisplacementMm: LIMITS.maxTargetDisplacementMm,
      maxTargetPressureBar: LIMITS.maxTargetPressureBar,
    },
  };

  const unregister = registerMachineHandlers({
    ipcMain,
    getWindow: () => mainWindow,
    controller,
    sensors,
    info,
  });

  void client.connect().catch((err: unknown) => {
    // SensorManager keeps retrying and reports the state to the UI.
    console.error('[Modbus] initial connect failed:', err instanceof Error ? err.message : err);
  });
  sensors.start();

  console.log(
    SIMULATION
      ? '[App] SIMULATION mode - no hardware in use'
      : `[App] HARDWARE mode - Modbus RTU on ${SERIAL.path} @ ${SERIAL.baudRate} baud`,
  );

  teardown = () => {
    controller.dispose(); // commands the output off
    unregister();
    void sensors.stop();
    void client.disconnect();
  };
}

app.whenReady().then(() => {
  createWindow();
  startMachine();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  teardown?.();
  teardown = null;
});

app.on('window-all-closed', () => {
  app.quit();
});
