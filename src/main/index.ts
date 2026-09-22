import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { SEED_PROFILES } from '../shared/recipe';
import { uiZoomFor } from '../shared/screen';
import type { AppInfo, DatabaseStatus } from '../shared/types';
import { ACQUISITION, GEOMETRY, HISTORY, LIMITS, SERIAL, SIMULATION, TIMING } from './config';
import { CycleLogger } from './db/CycleLogger';
import { MachineStore } from './db/MachineStore';
import { openDatabase } from './db/openDatabase';
import { registerMachineHandlers } from './ipc/machineHandlers';
import { CrimpController } from './machine/CrimpController';
import { LogMachineOutput, SimulatedMachineOutput, type MachineOutput } from './machine/MachineOutput';
import { ModbusClient, type IModbusClient } from './modbus/ModbusClient';
import { SensorManager } from './sensors/SensorManager';
import { SimulatedModbusClient } from './simulation/SimulatedModbusClient';
import { SimulatedPlant } from './simulation/SimulatedPlant';

let mainWindow: BrowserWindow | null = null;
let teardown: (() => void) | null = null;

/** UI zoom for the window size (see shared/screen.ts). `CRIMP_UI_ZOOM=1.25` forces a value. */
function zoomForWindow(win: BrowserWindow): number {
  const forced = Number(process.env.CRIMP_UI_ZOOM);
  if (Number.isFinite(forced) && forced >= 0.5 && forced <= 3) return forced;
  const [width, height] = win.getContentSize();
  return uiZoomFor(width, height);
}

function createWindow(): void {
  const kiosk = process.env.CRIMP_KIOSK === '1';
  // Never open larger than the screen (7" panels are 800x480 / 1024x600).
  const work = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1280, work.width),
    height: Math.min(800, work.height),
    minWidth: Math.min(760, work.width),
    minHeight: Math.min(440, work.height),
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

  // Large panels (12"+) get a bigger UI; small ones a compact layout (renderer). No pinch zoom.
  const win = mainWindow;
  const applyZoom = (): void => {
    if (!win.isDestroyed()) win.webContents.setZoomFactor(zoomForWindow(win));
  };
  void win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on('did-finish-load', applyZoom);
  win.on('resize', applyZoom);

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

/**
 * Opens the SQLite file (recipes + cycle history). A failure here - for example
 * the native module not matching Electron - must not stop the machine screen
 * from working, so it is reported to the UI instead of thrown.
 */
async function openStore(): Promise<{ store: MachineStore | null; status: DatabaseStatus }> {
  const path = process.env.CRIMP_DB_PATH || join(app.getPath('userData'), HISTORY.fileName);
  try {
    const store = new MachineStore(await openDatabase(path));
    store.seedProfiles(SEED_PROFILES);
    console.log(`[DB] SQLite ready: ${path}`);
    return { store, status: { ok: true, path, error: null } };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[DB] could not open the database:', error);
    return { store: null, status: { ok: false, path, error } };
  }
}

/** Wire the machine together. Simulation and hardware differ only in these three objects. */
function startMachine(store: MachineStore | null, database: DatabaseStatus): void {
  const plant = SIMULATION ? new SimulatedPlant() : null;
  const client: IModbusClient = plant ? new SimulatedModbusClient(plant) : new ModbusClient();
  // v1: outputs are simulated or log-only. No physical switch/solenoid control.
  const output: MachineOutput = plant ? new SimulatedMachineOutput(plant) : new LogMachineOutput();

  const sensors = new SensorManager(client, {
    sampleRateHz: TIMING.sampleRateHz,
    maxConsecutiveErrors: ACQUISITION.maxConsecutiveErrors,
    reconnectIntervalMs: ACQUISITION.reconnectIntervalMs,
  });
  const controller = new CrimpController(sensors, output, LIMITS, GEOMETRY);

  // Every finished cycle goes into the history (the controller knows nothing about SQL).
  let logger: CycleLogger | null = null;
  if (store) {
    logger = new CycleLogger(store, { logSamples: HISTORY.logSamples });
    logger.attach(controller);
  }

  const info: AppInfo = {
    simulation: SIMULATION,
    sampleRateHz: TIMING.sampleRateHz,
    uiRateHz: TIMING.uiRateHz,
    geometry: GEOMETRY, //test
    database,
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
    geometry: GEOMETRY,
    store,
    logger,
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
    logger?.detach();
    unregister();
    void sensors.stop();
    void client.disconnect();
    // Let queued cycle writes finish, then close the file cleanly.
    void (logger ? logger.flush() : Promise.resolve()).finally(() => store?.close());
  };
}

app.whenReady().then(async () => {
  const { store, status } = await openStore();
  createWindow();
  startMachine(store, status);

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
