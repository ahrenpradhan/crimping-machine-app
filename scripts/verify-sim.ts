/**
 * Headless check of the whole main-process stack in simulation:
 *   plant -> simulated Modbus (raw counts) -> SensorManager -> CrimpController
 *
 * Run with:  npm run verify        (no Electron window, no hardware)
 */
import type { IModbusClient } from '../src/main/modbus/ModbusClient';
import { LIMITS } from '../src/main/config';
import { CrimpController } from '../src/main/machine/CrimpController';
import { SimulatedMachineOutput } from '../src/main/machine/MachineOutput';
import { LinearSensor } from '../src/main/sensors/LinearSensor';
import { PressureSensor } from '../src/main/sensors/PressureSensor';
import { SensorManager } from '../src/main/sensors/SensorManager';
import { SimulatedModbusClient } from '../src/main/simulation/SimulatedModbusClient';
import { SimulatedPlant } from '../src/main/simulation/SimulatedPlant';
import type { AnalogChannel, MachineStatus } from '../src/shared/types';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
  if (!ok) failures++;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(10);
  }
  return pred();
}

/** Wraps the simulator so a "wire break" can be injected. */
class FlakyClient implements IModbusClient {
  broken = false;
  constructor(private readonly inner: SimulatedModbusClient) {}
  connect = () => this.inner.connect();
  disconnect = () => this.inner.disconnect();
  readRegister = (a: number) => this.inner.readRegister(a);
  readAnalogInput = (c: AnalogChannel) => this.inner.readAnalogInput(c);
  getConnectionStatus = () => this.inner.getConnectionStatus();
  async readAnalogInputs(): Promise<Record<AnalogChannel, number>> {
    if (this.broken) throw new Error('Modbus timeout (injected)');
    return this.inner.readAnalogInputs();
  }
}

async function main(): Promise<void> {
  // ---- 1. Raw -> engineering conversion round trip -----------------------
  const lin = new LinearSensor();
  const pV = new PressureSensor();
  const pMa = new PressureSensor({
    inputType: '4-20mA',
    rawFullScale: 4095,
    engMin: 0,
    engMax: 600,
    zeroOffset: 0,
  });
  const close = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
  check(
    'linear 0-10V round trip (25 mm)',
    close(lin.convert(lin.engineeringToRaw(25)).value, 25, 0.02),
  );
  check(
    'pressure 0-10V round trip (320 bar)',
    close(pV.convert(pV.engineeringToRaw(320)).value, 320, 0.2),
  );
  check(
    'pressure 4-20mA round trip (320 bar)',
    close(pMa.convert(pMa.engineeringToRaw(320)).value, 320, 0.2),
  );
  let wireBreak = false;
  try {
    pMa.convert(0);
  } catch {
    wireBreak = true;
  }
  check('4-20mA reading of 0 counts is flagged as wire break', wireBreak);

  // ---- 2. Full stack -----------------------------------------------------
  const plant = new SimulatedPlant();
  const client = new FlakyClient(new SimulatedModbusClient(plant));
  const output = new SimulatedMachineOutput(plant);
  const sensors = new SensorManager(client);
  const controller = new CrimpController(sensors, output, LIMITS);

  const seen: MachineStatus[] = [];
  controller.onStateChange((s) => seen.push(s.status));

  await client.connect();
  sensors.start();
  check('sensors become OK', await waitFor(() => sensors.getStatus().health === 'OK', 2000));
  await sleep(1200);
  const rate = sensors.getStatus().measuredRateHz;
  check('acquisition rate is close to 100 Hz', rate >= 60, `${rate} Hz measured`);
  check(
    'raw getters return counts',
    sensors.getRawDisplacement() !== null && sensors.getRawPressure() !== null,
  );

  // ---- 3. Crimp by LINEAR -----------------------------------------------
  let r = controller.startLinearCrimp(25);
  check('linear start accepted', r.ok);
  check('cannot start a second cycle while running', !controller.startLinearCrimp(20).ok);
  check(
    'linear crimp completes',
    await waitFor(() => controller.getState().status === 'COMPLETE', 15000),
  );
  let st = controller.getState();
  let samples = controller.getCycleSamples();
  check(
    'state sequence IDLE->CRIMPING_LINEAR->TARGET_DISPLACEMENT_REACHED->COMPLETE',
    seen.join(',') === 'CRIMPING_LINEAR,TARGET_DISPLACEMENT_REACHED,COMPLETE',
    seen.join(','),
  );
  check(
    'final displacement at/just over 25 mm',
    st.cycle !== null && st.cycle.finalDisplacementMm >= 25 && st.cycle.finalDisplacementMm < 27,
    `${st.cycle?.finalDisplacementMm.toFixed(2)} mm`,
  );
  check(
    'pressure was recorded and rose with displacement',
    st.cycle !== null && st.cycle.peakPressureBar > 100,
    `peak ${st.cycle?.peakPressureBar.toFixed(1)} bar`,
  );
  check('cycle data recorded (~100 Hz)', samples.length > 100, `${samples.length} samples`);
  check('cycle starts at t=0', samples[0]?.timestamp === 0);
  check(
    'timestamps strictly increasing',
    samples.every((s, i) => i === 0 || s.timestamp > samples[i - 1].timestamp),
  );

  // Data stays available after the cycle (for the completed graph).
  await sleep(300);
  check('cycle data kept after completion', controller.getCycleSamples().length === samples.length);

  // ---- 4. Crimp by PRESSURE ---------------------------------------------
  controller.stopCrimp(); // COMPLETE -> IDLE
  check('COMPLETE -> IDLE on stop', controller.getState().status === 'IDLE');
  check(
    'machine reopens by itself (sim)',
    await waitFor(() => (sensors.getDisplacement() ?? 99) < 1 && (sensors.getPressure() ?? 999) < 30, 8000),
  );
  seen.length = 0;
  r = controller.startPressureCrimp(320);
  check('pressure start accepted', r.ok);
  check(
    'pressure crimp completes',
    await waitFor(() => controller.getState().status === 'COMPLETE', 15000),
  );
  st = controller.getState();
  samples = controller.getCycleSamples();
  check(
    'state sequence CRIMPING_PRESSURE->TARGET_PRESSURE_REACHED->COMPLETE',
    seen.join(',') === 'CRIMPING_PRESSURE,TARGET_PRESSURE_REACHED,COMPLETE',
    seen.join(','),
  );
  check(
    'final pressure at/just over 320 bar',
    st.cycle !== null && st.cycle.finalPressureBar >= 315 && st.cycle.finalPressureBar < 345,
    `${st.cycle?.finalPressureBar.toFixed(1)} bar`,
  );
  check(
    'displacement recorded during pressure crimp',
    st.cycle !== null && st.cycle.finalDisplacementMm > 10,
    `${st.cycle?.finalDisplacementMm.toFixed(2)} mm`,
  );
  check('new cycle id assigned', st.cycleId === 2, `cycleId ${st.cycleId}`);
  console.log(
    `      pressure cycle: ${samples.length} samples over ${(st.cycle?.durationMs ?? 0) / 1000} s`,
  );

  // ---- 5. Stop mid-cycle -------------------------------------------------
  controller.stopCrimp();
  await waitFor(() => (sensors.getDisplacement() ?? 99) < 1, 8000);
  controller.startLinearCrimp(40);
  await sleep(700);
  controller.stopCrimp();
  check(
    'stop mid-cycle -> IDLE, result STOPPED, data kept',
    controller.getState().status === 'IDLE' &&
      controller.getState().cycle?.result === 'STOPPED' &&
      controller.getCycleSamples().length > 20,
  );
  check('output stopped', !output.isClosing());

  // ---- 6. Rejected commands ---------------------------------------------
  await waitFor(() => (sensors.getDisplacement() ?? 99) < 1, 8000);
  check('target above maximum rejected', !controller.startPressureCrimp(9999).ok);
  check('zero target rejected', !controller.startLinearCrimp(0).ok);
  check('NaN target rejected', !controller.startLinearCrimp(Number.NaN).ok);

  // ---- 7. Fault: sensor loss during a crimp -----------------------------
  controller.startPressureCrimp(390);
  await sleep(500);
  client.broken = true;
  check(
    'sensor loss during crimp -> FAULT',
    await waitFor(() => controller.getState().status === 'FAULT', 2000),
  );
  check('FAULT stops closing', !output.isClosing());
  check('cannot start while FAULT', !controller.startLinearCrimp(10).ok);
  client.broken = false;
  check(
    'sensors recover',
    await waitFor(() => sensors.getStatus().health === 'OK', 2000),
  );
  controller.stopCrimp(); // acknowledge
  check('stop acknowledges FAULT -> IDLE', controller.getState().status === 'IDLE');

  // ---- done --------------------------------------------------------------
  controller.dispose();
  await sensors.stop();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
