/**
 * Headless check of the whole main-process stack in simulation:
 *   plant -> simulated Modbus (raw counts) -> SensorManager -> CrimpController
 *
 * Run with:  npm run verify        (no Electron window, no hardware)
 */
import type { IModbusClient } from '../src/main/modbus/ModbusClient';
import { GEOMETRY, LIMITS } from '../src/main/config';
import { CycleLogger } from '../src/main/db/CycleLogger';
import { MachineStore } from '../src/main/db/MachineStore';
import { MIGRATIONS } from '../src/main/db/schema';
import type { SqlDb } from '../src/main/db/SqlDb';
import { CrimpController } from '../src/main/machine/CrimpController';
import { SimulatedMachineOutput } from '../src/main/machine/MachineOutput';
import { LinearSensor } from '../src/main/sensors/LinearSensor';
import { PressureSensor } from '../src/main/sensors/PressureSensor';
import { SensorManager } from '../src/main/sensors/SensorManager';
import { SimulatedModbusClient } from '../src/main/simulation/SimulatedModbusClient';
import { SimulatedPlant } from '../src/main/simulation/SimulatedPlant';
import {
  DEFAULT_LINEAR_PARAMS,
  displacementForDiameter,
  parseLinearParams,
  planLinearCrimp,
} from '../src/shared/linear';
import {
  DEFAULT_PRESSURE_PARAMS,
  parsePressureParams,
} from '../src/shared/pressure';
import {
  DEFAULT_PROFILE,
  coerceRecipes,
  planRecipeFromLinearCycle,
  recipeBlocker,
} from '../src/shared/recipe';
import { SEED_PROFILES } from '../src/shared/recipe';
import { uiZoomFor } from '../src/shared/screen';
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

/**
 * SQLite for the tests: Node's built-in `node:sqlite` (Node 22.5+). The app itself
 * uses better-sqlite3 (built for Electron, so it cannot be loaded by plain Node);
 * MachineStore only needs the small SqlDb interface, which both provide.
 */
async function openTestDb(): Promise<SqlDb | null> {
  try {
    const spec = 'node:sqlite'; // variable: keeps the type checker (Node 20 types) out of it
    const { DatabaseSync } = await import(spec);
    const raw = new DatabaseSync(':memory:');
    return {
      exec: (sql: string) => raw.exec(sql),
      prepare: (sql: string) => {
        const st = raw.prepare(sql);
        return {
          run: (...p: never[]) => st.run(...p),
          get: (...p: never[]) => st.get(...p),
          all: (...p: never[]) => st.all(...p),
        };
      },
      close: () => raw.close(),
    };
  } catch {
    return null;
  }
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

  // History database (skipped when this Node has no node:sqlite)
  const testDb = await openTestDb();
  const store = testDb ? new MachineStore(testDb) : null;
  store?.seedProfiles(SEED_PROFILES);
  const logger = store ? new CycleLogger(store, { logSamples: true, sessionId: 'verify' }) : null;
  logger?.attach(controller);
  let finishedEvents = 0;
  controller.onCycleFinished(() => finishedEvents++);
  if (!store) console.log('SKIP  database checks - this Node has no node:sqlite (needs Node 22.5+)');

  const seen: MachineStatus[] = [];
  const seenAt: Record<string, number> = {};
  let lastStatus: MachineStatus = 'IDLE';
  controller.onStateChange((s) => {
    if (s.status !== lastStatus) {
      lastStatus = s.status;
      seen.push(s.status);
      seenAt[s.status] = Date.now();
    }
  });

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

  // ---- 3. Crimp by LINEAR (diameter parameters) -------------------------
  const params = { ...DEFAULT_LINEAR_PARAMS, holdTimeSec: 0.6 };
  const plan = planLinearCrimp(params, GEOMETRY);
  check(
    'plan: 32 mm + 0.2 correction from 74 mm open -> effective 32.2 mm, 41.8 mm stroke',
    close(plan.effectiveDiameterMm, 32.2, 1e-9) && close(plan.targetStrokeMm, 41.8, 1e-9),
    `${plan.effectiveDiameterMm} mm / ${plan.targetStrokeMm} mm`,
  );
  check(
    'diameter <-> stroke round trip',
    close(displacementForDiameter(74, 32.2, GEOMETRY), 41.8, 1e-9),
  );
  check('params: default accepted', parseLinearParams(DEFAULT_LINEAR_PARAMS).ok);
  check(
    'params: target >= open diameter rejected',
    !parseLinearParams({ ...DEFAULT_LINEAR_PARAMS, targetDiameterMm: 80 }).ok,
  );
  check(
    'params: out-of-range hold time rejected',
    !parseLinearParams({ ...DEFAULT_LINEAR_PARAMS, holdTimeSec: 99 }).ok,
  );
  check('params: non-object rejected', !parseLinearParams(25).ok);

  let r = controller.startLinearCrimp(plan.targetStrokeMm, { holdTimeMs: 600, linear: params });
  check('linear start accepted', r.ok);
  check('cannot start a second cycle while running', !controller.startLinearCrimp(20).ok);
  check('cannot teach open position while running', !controller.teachOpenPosition().ok);
  check(
    'linear crimp completes',
    await waitFor(() => controller.getState().status === 'COMPLETE', 20000),
  );
  let st = controller.getState();
  let samples = controller.getCycleSamples();
  check(
    'state sequence CRIMPING_LINEAR->TARGET_DISPLACEMENT_REACHED->COMPLETE',
    seen.join(',') === 'CRIMPING_LINEAR,TARGET_DISPLACEMENT_REACHED,COMPLETE',
    seen.join(','),
  );
  const dwell = (seenAt['COMPLETE'] ?? 0) - (seenAt['TARGET_DISPLACEMENT_REACHED'] ?? 0);
  check('hold time honoured (>= 0.6 s in TARGET_REACHED)', dwell >= 590, `${dwell} ms`);
  check(
    'final stroke at/just over 41.8 mm',
    st.cycle !== null && st.cycle.finalDisplacementMm >= 41.8 && st.cycle.finalDisplacementMm < 43.5,
    `${st.cycle?.finalDisplacementMm.toFixed(2)} mm`,
  );
  check(
    'final die diameter at/just under 32.2 mm',
    st.cycle?.finalDiameterMm != null &&
      st.cycle.finalDiameterMm <= 32.25 &&
      st.cycle.finalDiameterMm > 30.5,
    `${st.cycle?.finalDiameterMm?.toFixed(2)} mm`,
  );
  check(
    'cycle remembers its diameter parameters',
    st.cycle?.linear?.dieSizeMm === 32 && st.cycle.linear.openDiameterMm === 74,
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
  check(
    'good counter incremented on COMPLETE',
    st.counters.good === 1 && st.counters.bad === 0 && st.counters.total === 1,
    JSON.stringify(st.counters),
  );

  check(
    'atTarget recorded for the linear cycle (pressure + diameter)',
    st.cycle?.atTarget != null &&
      st.cycle.atTarget.pressureBar > 100 &&
      st.cycle.atTarget.diameterMm !== null &&
      st.cycle.atTarget.diameterMm <= 32.25,
    JSON.stringify(st.cycle?.atTarget),
  );

  // ---- 3b. Recipe from the linear crimp -----------------------------------
  check('no recipe before any crimp', recipeBlocker(null) !== null);
  const planned = planRecipeFromLinearCycle(st.cycle, {
    name: 'Test hose',
    toleranceMm: 0.5,
    profileId: DEFAULT_PROFILE.id,
    id: 'r1',
    now: 1,
  });
  check('recipe planned from the completed linear crimp', planned.ok, planned.ok ? '' : planned.error);
  if (planned.ok) {
    const rp = planned.recipe.pressure;
    const dia = st.cycle?.atTarget?.diameterMm ?? 0;
    check(
      'recipe target pressure = pressure the crimp needed',
      close(rp.targetPressureBar, st.cycle?.atTarget?.pressureBar ?? -1, 0.06),
      `${rp.targetPressureBar} bar`,
    );
    check(
      'recipe window = reached diameter +/- 0.5 mm',
      close(rp.minDiameterMm, dia - 0.5, 0.01) && close(rp.maxDiameterMm, dia + 0.5, 0.01),
      `${rp.minDiameterMm} - ${rp.maxDiameterMm}`,
    );
    check(
      'recipe copies die, open diameter and hold time',
      rp.dieSizeMm === 32 && rp.openDiameterMm === 74 && rp.holdTimeSec === 0.6,
    );
    check('recipe survives storage round trip', coerceRecipes(JSON.parse(JSON.stringify([planned.recipe])))?.[0]?.pressure.targetPressureBar === rp.targetPressureBar);
  }
  if (planned.ok) store?.saveRecipe(planned.recipe);
  check(
    'blank recipe name rejected',
    !planRecipeFromLinearCycle(st.cycle, { name: '  ', toleranceMm: 0.5, profileId: 'default', id: 'x', now: 1 }).ok,
  );
  check('malformed stored recipes are dropped', (coerceRecipes([{ nope: 1 }, 5]) ?? []).length === 0);

  // Data stays available after the cycle (for the completed graph).
  await sleep(300);
  check('cycle data kept after completion', controller.getCycleSamples().length === samples.length);

  // ---- 4. Crimp by PRESSURE ---------------------------------------------
  controller.stopCrimp(); // COMPLETE -> IDLE
  check('COMPLETE -> IDLE on stop', controller.getState().status === 'IDLE');
  check(
    'machine reopens by itself (sim)',
    await waitFor(() => (sensors.getDisplacement() ?? 99) < 1 && (sensors.getPressure() ?? 999) < 30, 12000),
  );
  seen.length = 0;
  r = controller.startPressureCrimp(320);
  check('pressure start accepted', r.ok);
  check(
    'pressure crimp completes',
    await waitFor(() => controller.getState().status === 'COMPLETE', 20000),
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
    st.cycle !== null && st.cycle.finalPressureBar >= 315 && st.cycle.finalPressureBar < 350,
    `${st.cycle?.finalPressureBar.toFixed(1)} bar`,
  );
  check(
    'displacement recorded during pressure crimp',
    st.cycle !== null && st.cycle.finalDisplacementMm > 20 && st.cycle.finalDiameterMm === null,
    `${st.cycle?.finalDisplacementMm.toFixed(2)} mm`,
  );
  check('new cycle id assigned', st.cycleId === 2, `cycleId ${st.cycleId}`);
  check('good counter is now 2', st.counters.good === 2, JSON.stringify(st.counters));
  console.log(
    `      pressure cycle: ${samples.length} samples over ${(st.cycle?.durationMs ?? 0) / 1000} s`,
  );

  // ---- 4b. Crimp by PRESSURE with the Uniflex parameters ---------------
  check('pressure params: default accepted', parsePressureParams(DEFAULT_PRESSURE_PARAMS).ok);
  check(
    'pressure params: min >= max rejected',
    !parsePressureParams({ ...DEFAULT_PRESSURE_PARAMS, minDiameterMm: 60, maxDiameterMm: 50 }).ok,
  );
  check('pressure params: a bare number is rejected', !parsePressureParams(320).ok);

  controller.stopCrimp();
  await waitFor(() => (sensors.getDisplacement() ?? 99) < 1 && (sensors.getPressure() ?? 999) < 30, 12000);
  controller.resetCounters();
  const pp = { ...DEFAULT_PRESSURE_PARAMS, targetPressureBar: 260, holdTimeSec: 0.5 };
  const speeds: string[] = [];
  const origSpeed = output.setClosingSpeed.bind(output);
  output.setClosingSpeed = (sp) => {
    speeds.push(sp);
    origSpeed(sp);
  };
  r = controller.startPressureCrimp(pp.targetPressureBar, { holdTimeMs: 500, pressure: pp });
  check('pressure job with parameters accepted', r.ok);
  check(
    'pressure job completes',
    await waitFor(() => controller.getState().status === 'COMPLETE', 30000),
  );
  st = controller.getState();
  check('closing switched to SLOW exactly once', speeds.join(',') === 'SLOW', speeds.join(','));
  check('cycle reports slowEngaged', st.cycle?.slowEngaged === true);
  check(
    'slow-down happened at the pressure point (~50 bar), before the diameter point',
    (() => {
      const cs = controller.getCycleSamples();
      const first = cs.findIndex((c) => c.pressureBar >= 50);
      return first > 0 && cs[first].displacementMm < 74 - 38.2;
    })(),
  );
  check(
    'final Ø recorded and inside the accepted window -> Good',
    st.cycle?.finalDiameterMm != null &&
      st.cycle.withinTolerance === true &&
      st.counters.good === 1 &&
      st.counters.bad === 0,
    `${st.cycle?.finalDiameterMm?.toFixed(2)} mm, ${JSON.stringify(st.counters)}`,
  );

  // Same job with a window that cannot be met -> counted as Bad.
  controller.stopCrimp();
  await waitFor(() => (sensors.getDisplacement() ?? 99) < 1 && (sensors.getPressure() ?? 999) < 30, 12000);
  const tight = { ...pp, minDiameterMm: 45, maxDiameterMm: 46, holdTimeSec: 0 };
  controller.startPressureCrimp(tight.targetPressureBar, { holdTimeMs: 0, pressure: tight });
  await waitFor(() => controller.getState().status === 'COMPLETE', 30000);
  st = controller.getState();
  check(
    'Ø outside the window -> withinTolerance false, counted Bad',
    st.cycle?.withinTolerance === false && st.counters.bad === 1 && st.counters.good === 1,
    JSON.stringify(st.counters),
  );
  output.setClosingSpeed = origSpeed;
  controller.resetCounters();

  // ---- 4c. Production with the recipe (tagged cycles) -----------------------
  if (planned.ok && store) {
    const recipe = planned.recipe;
    const tag = (modified: boolean) => ({
      profileId: 'default',
      recipeId: recipe.id,
      recipeName: recipe.name,
      recipeModified: modified,
    });
    for (let i = 0; i < 2; i++) {
      controller.stopCrimp();
      await waitFor(() => (sensors.getDisplacement() ?? 99) < 1 && (sensors.getPressure() ?? 999) < 30, 12000);
      controller.startPressureCrimp(recipe.pressure.targetPressureBar, {
        holdTimeMs: 300,
        pressure: recipe.pressure,
        tag: tag(false),
      });
      await waitFor(() => controller.getState().status === 'COMPLETE', 30000);
    }
    check(
      'recipe production cycles complete inside the recipe window',
      controller.getState().cycle?.withinTolerance === true,
      `${controller.getState().cycle?.finalDiameterMm?.toFixed(2)} mm`,
    );
    controller.stopCrimp();
    await waitFor(() => (sensors.getDisplacement() ?? 99) < 1 && (sensors.getPressure() ?? 999) < 30, 12000);
    const edited = { ...recipe.pressure, targetPressureBar: recipe.pressure.targetPressureBar - 20 };
    controller.startPressureCrimp(edited.targetPressureBar, { holdTimeMs: 300, pressure: edited, tag: tag(true) });
    await waitFor(() => controller.getState().status === 'COMPLETE', 30000);
  }

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

  // ---- 5b. Teach open position + counters --------------------------------
  await sleep(150); // ram is holding position for 1.5 s after a stop (sim)
  const before = sensors.getDisplacement() ?? 0;
  check('ram is away from home before teaching', before > 3, `${before.toFixed(2)} mm`);
  check('teach open position accepted when idle', controller.teachOpenPosition().ok);
  const after = sensors.getDisplacement() ?? 99;
  check(
    'displacement reads ~0 after teaching',
    Math.abs(after) < 0.3,
    `${after.toFixed(3)} mm, offset ${sensors.getStatus().zeroOffsetMm.toFixed(2)} mm`,
  );
  check('zero offset reported in sensor status', sensors.getStatus().zeroOffsetMm > 3);
  sensors.resetDisplacementZero();
  check('zero offset can be cleared', sensors.getStatus().zeroOffsetMm === 0);

  const c0 = controller.getState().counters;
  controller.addRejected();
  const c1 = controller.getState().counters;
  check(
    'bad counter + total update',
    c1.bad === c0.bad + 1 && c1.total === c0.total + 1 && c1.good === c0.good,
    JSON.stringify(c1),
  );
  controller.resetCounters();
  check(
    'reset zeroes all counters',
    JSON.stringify(controller.getState().counters) === '{"good":0,"bad":0,"total":0}',
  );

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

  // ---- 8. History database ------------------------------------------------
  if (store && logger && planned.ok) {
    await logger.flush();
    const recipe = planned.recipe;
    const all = store.listCycles({ limit: 1000 });
    check(
      'every finished cycle was written to the database',
      all.length === finishedEvents && all.length >= 8,
      `${all.length} rows / ${finishedEvents} cycles`,
    );
    check(
      'history holds COMPLETE, STOPPED and FAULT cycles of both modes',
      ['COMPLETE', 'STOPPED', 'FAULT'].every((r) => all.some((c) => c.result === r)) &&
        ['LINEAR', 'PRESSURE'].every((m) => all.some((c) => c.mode === m)),
    );
    const faulted = all.find((c) => c.result === 'FAULT');
    check('FAULT cycle keeps its fault message', (faulted?.faultMessage ?? '').length > 0, faulted?.faultMessage ?? '');

    const forRecipe = store.listCycles({ recipeId: recipe.id });
    check('3 cycles filed under the recipe', forRecipe.length === 3, `${forRecipe.length}`);
    check(
      'one of them is flagged as run with edited parameters',
      forRecipe.filter((c) => c.recipeModified).length === 1 &&
        forRecipe.every((c) => c.recipeName === recipe.name),
    );
    const good = forRecipe.find((c) => c.result === 'COMPLETE' && !c.recipeModified);
    check(
      'logged cycle carries result values and parameters',
      good !== undefined &&
        good.mode === 'PRESSURE' &&
        good.atTargetPressureBar !== null &&
        good.atTargetPressureBar >= recipe.pressure.targetPressureBar &&
        good.atTargetDiameterMm !== null &&
        good.withinTolerance === true &&
        (good.params as { targetPressureBar?: number } | null)?.targetPressureBar === recipe.pressure.targetPressureBar &&
        good.finishedAt - good.startedAt === good.durationMs,
      JSON.stringify({ p: good?.atTargetPressureBar, d: good?.atTargetDiameterMm }),
    );
    check('linear set-up cycles are logged without a recipe', all.some((c) => c.mode === 'LINEAR' && c.recipeId === null));

    const samplesOfGood = good ? store.getCycleSamples(good.id) : [];
    check(
      'the recorded curve is stored and read back',
      samplesOfGood.length > 100 &&
        samplesOfGood[0].timestamp === 0 &&
        samplesOfGood.some((s) => s.pressureBar > 200),
      `${samplesOfGood.length} samples`,
    );

    let stats = store.recipeStats('default')[recipe.id];
    // 2 production cycles at the recipe pressure are Good; the one with the lowered
    // pressure ends at a larger diameter, outside the window -> Bad.
    check(
      'recipe stats: 3 cycles, 2 good, 1 bad (the edited one, out of tolerance)',
      stats?.cycles === 3 && stats.good === 2 && stats.bad === 1 && stats.lastRunAt !== null,
      JSON.stringify(stats),
    );
    check(
      'the edited cycle really is out of tolerance',
      forRecipe.find((c) => c.recipeModified)?.withinTolerance === false,
    );
    if (good) store.markCycleRejected(good.id);
    stats = store.recipeStats('default')[recipe.id];
    check('operator "+" on a good cycle turns it into a bad one: 1 good, 2 bad', stats?.good === 1 && stats.bad === 2, JSON.stringify(stats));
    logger.markLastRejected();
    check(
      'logger marks the most recent logged cycle',
      store.listCycles({ limit: 1 })[0]?.operatorRejected === 1,
    );

    check('recipe reads back from its own columns', JSON.stringify(store.getRecipe(recipe.id)?.pressure) === JSON.stringify(recipe.pressure));
    store.saveRecipe({ ...recipe, name: 'Renamed' });
    check('saving an existing id updates it', store.getRecipe(recipe.id)?.name === 'Renamed' && store.listRecipes('default').length === 1);
    check('re-import of an existing recipe adds nothing', store.importRecipes([recipe]) === 0);

    check('deleting a recipe removes it from the list', store.deleteRecipe(recipe.id) && store.listRecipes('default').length === 0);
    const after = store.listCycles({ recipeId: recipe.id });
    check(
      'but its cycle history is kept',
      after.length === 3 && after.every((c) => c.recipeName === recipe.name),
    );
    check('a second delete reports nothing to delete', !store.deleteRecipe(recipe.id));

    // ---- Profiles ----------------------------------------------------------
    const profilesBefore = store.listProfiles();
    check(
      'default profile is listed first with its counts',
      profilesBefore[0]?.id === 'default' && profilesBefore[0].cycleCount === all.length && profilesBefore[0].recipeCount === 0,
      JSON.stringify(profilesBefore[0]),
    );
    const night = store.createProfile('  Night   shift ');
    check('a profile can be created (name tidied)', night.name === 'Night shift' && night.id !== 'default');
    check('it is listed after the default one', store.listProfiles().map((p) => p.id).join() === `default,${night.id}`);
    const thrown = (fn: () => void): string => {
      try {
        fn();
        return '';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    };
    check('duplicate name (any case) is refused', thrown(() => store.createProfile('NIGHT shift')).includes('already exists'));
    check('empty name is refused', thrown(() => store.createProfile('   ')) !== '');
    check('over-long name is refused', thrown(() => store.createProfile('x'.repeat(31))) !== '');
    check('getProfile finds it, unknown id gives null', store.getProfile(night.id)?.name === 'Night shift' && store.getProfile('nope') === null);

    store.saveRecipe({ ...recipe, id: 'night-r', name: 'Night recipe', profileId: night.id });
    check(
      'recipes belong to their profile',
      store.listRecipes(night.id).length === 1 && store.listRecipes('default').length === 0,
    );
    const { id: _id, hasSamples: _hs, operatorRejected: _or, ...base } = all[0];
    store.logCycle({ ...base, profileId: night.id, recipeId: 'night-r', recipeName: 'Night recipe', samples: null });
    check(
      'cycles belong to their profile (history and stats are per profile)',
      store.listCycles({ profileId: night.id }).length === 1 &&
        store.recipeStats(night.id)['night-r']?.cycles === 1 &&
        store.recipeStats('default')['night-r'] === undefined,
    );
    const summary = store.listProfiles().find((p) => p.id === night.id);
    check('profile counts update', summary?.recipeCount === 1 && summary.cycleCount === 1, JSON.stringify(summary));

    const again = new MachineStore(testDb as SqlDb);
    check('opening an up-to-date database again is harmless', again.listCycles({ limit: 1 }).length === 1);
    check('schema version recorded', Number((testDb!.prepare('PRAGMA user_version').get() as { user_version: number }).user_version) === MIGRATIONS.length);
  }

  // ---- screen sizes (7" / 10" / 12"+) --------------------------------------
  {
    const z = (w: number, h: number): number => uiZoomFor(w, h);
    check('7" and 10" screens are not zoomed', z(800, 480) === 1 && z(1024, 600) === 1 && z(1280, 800) === 1 && z(1280, 720) === 1);
    check('1366x768 is the 1:1 design size', z(1366, 768) === 1);
    check('1920x1080 zooms to about the design size (1.4)', z(1920, 1080) === 1.4, String(z(1920, 1080)));
    check('2560x1440 zooms 1.85', z(2560, 1440) === 1.85, String(z(2560, 1440)));
    check('a short window on a wide screen is not zoomed', z(1919, 681) === 1, String(z(1919, 681)));
    check('zoom is limited to 2 and bad sizes give 1', z(7680, 4320) === 2 && z(0, 0) === 1 && z(NaN, 800) === 1);
  }

  // ---- done --------------------------------------------------------------
  controller.dispose();
  await sensors.stop();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
