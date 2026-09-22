# Crimping Machine Control (v1 prototype)

Electron + React + TypeScript app for a crimping machine. Two operating modes only:

- **CRIMP BY LINEAR** - closes until the linear transducer reaches the target displacement (mm).
- **CRIMP BY PRESSURE** - closes until the pressure transducer reaches the target pressure (bar).

Both transducers are read continuously in both modes, and pressure, displacement and time are recorded for the whole cycle. Live graphs: Pressure vs Time, Displacement vs Time, Pressure vs Displacement (the curve stays on screen after the cycle ends). They are small tiles beside the parameters - tap one to open it full screen (tabs to change graph, CLOSE / Esc to return). CYCLE / LIVE picks the data; the switch "Auto-switch to cycle view on START" (on by default, remembered) decides whether a new cycle jumps the graphs back to CYCLE - when it is off the graphs stay where the operator left them.

Runs in **simulation mode by default** - no Raspberry Pi, RS485 adapter or I/O module needed.

> **Safety:** this is a prototype, not a safety-rated controller. Emergency stop must be hard-wired. In v1 the machine output is simulated / log-only - nothing physical is switched.

## Run

```bash
npm i
npm run dev          # simulation (default), hot reload
npm run verify       # headless test of sensors + both crimp modes + fault path (no window)
npm run typecheck
npm run build && npm start       # production build
```

Real hardware (Phase 5): `npm run dev:hw` / `npm run start:hw` (sets `CRIMP_SIMULATION=false`).

| Env var | Meaning |
| --- | --- |
| `CRIMP_SIMULATION=false` | use Modbus hardware instead of the simulator |
| `CRIMP_SERIAL_PORT` | e.g. `/dev/ttyUSB0` or `COM3` |
| `CRIMP_BAUD` | default 38400 |
| `CRIMP_KIOSK=1` | fullscreen kiosk window (Raspberry Pi touchscreen) |
| `CRIMP_DEVTOOLS=1` | open DevTools |

Package for the Pi: `npm run dist:pi` (AppImage + deb, arm64).

## Architecture

```
Linear / pressure transducer -> analog input (ADC) -> Modbus register -> RS485 -> USB-RS485 -> Pi
                                                         |
 main process (Node)                                     v
 ModbusClient  --raw counts-->  SensorManager (100 Hz)  --Sample-->  CrimpController (100 Hz)  --> MachineOutput
 (or Simulated)                 counts -> V/mA -> mm/bar              IDLE/CRIMPING/COMPLETE/FAULT   (log / sim)
                                        |                                   |
                                        +---------- IPC, batched ~15 Hz ----+
                                                         |
 renderer (React)  <------ preload.ts (contextBridge: window.machine) ------+
```

```
src/
  main/
    config.ts               ALL constants: SIMULATION, rates, limits, sensor calibration, serial
    modbus/RegisterMap.ts   the ONLY file with register addresses (placeholders - fill in)
    modbus/ModbusClient.ts  IModbusClient interface + real Modbus RTU client (modbus-serial)
    sensors/                AnalogSensor (raw -> V/mA -> unit), LinearSensor, PressureSensor, SensorManager
    machine/                CrimpController, MachineState, MachineOutput, CycleRecorder
    simulation/             SimulatedPlant (press model) + SimulatedModbusClient (raw counts + noise)
    ipc/machineHandlers.ts  the only place the renderer reaches machine logic
  preload/preload.ts        window.machine API (contextIsolation on, nodeIntegration off)
  renderer/                 minimal React UI + ECharts graphs (no machine logic)
  shared/types/             types shared by main / preload / renderer
  shared/linear.ts          diameter <-> stroke maths, linear parameter limits + validation (main and renderer)
  shared/pressure.ts        pressure-mode parameter defaults, limits + validation
scripts/verify-sim.ts       headless end-to-end check
```

`window.machine`: `getSensors`, `getState`, `getCycleData`, `getAppInfo`, `startLinearCrimp(params, context)`, `startPressureCrimp(params, context)`, `stopCrimp`, `addRejected`, `resetCounters`, `teachOpenPosition`, `onTick(cb)`, `onState(cb)`.
`CrimpController.startLinearCrimp(strokeMm, options?)` itself still takes a displacement target; the IPC layer converts the diameter parameters into that stroke.

### CRIMP BY LINEAR parameters (modelled on the Uniflex screen)

The operator works in die **diameters**; the controller still stops on the **linear transducer's stroke**.

| Parameter | Meaning |
| --- | --- |
| Target diameter | Ø to crimp to (e.g. 32 mm) |
| Correction (+/-) | Signed trim added to the target for spring-back (e.g. +0.2 mm -> stops at 32.2 mm; a positive value gives a larger final diameter) |
| Die size | Installed die set (recorded with each cycle, informational) |
| Open diameter | Die Ø at the open (zero-stroke) position (e.g. 74 mm) |
| Teach open position | Two-tap button: declares the current ram position to be fully open (zeroes the displacement, keeps a 0.25 s average). Only when idle; not persisted across restarts |
| Hold time | Dwell after the target is reached, before the cycle completes. The output has already stopped; the dwell is recorded on the graphs |

```
diameter = openDiameter - GEOMETRY.diameterMmPerStrokeMm x displacement
stops at displacement >= (openDiameter - (target + correction)) / diameterMmPerStrokeMm
```

**`GEOMETRY.diameterMmPerStrokeMm` in `src/main/config.ts` is a placeholder (1.0).** Set the real mechanical ratio for your machine - it decides where a diameter target stops the ram. The maths lives in `src/shared/linear.ts`.

Also on screen: live die diameter, and **Good / Bad / Total** piece counters (Good counts up on every completed crimp, `+` adds a bad piece, RESET needs two taps). Counters are in memory (reset when the app restarts); operator parameters and the selected mode are remembered between runs.

Not implemented from the Uniflex screens: recipe rename / edit screen, the bottom-right block of three mm values (20 / 20 / 42 mm - purpose unclear), the grey pressure box top-left, the auto-open (A) button (needs the real output layer, Phase 6), the batch-number counter, QDC/CMK/PFM pages.

### CRIMP BY PRESSURE parameters (modelled on the Uniflex pressure screen)

| Parameter | Meaning |
| --- | --- |
| Target pressure | Closing stops when the pressure transducer reaches this (bar) |
| Die size / Open diameter / Teach open position | Same as in linear mode. The die is physically the same, so these two values are kept identical in both modes |
| Hold time | Dwell after the target pressure is reached |
| Slow down at diameter (38.2 mm) / at pressure (50 bar) | Closing runs fast, then switches to slow when the die diameter falls to the first value **or** the pressure reaches the second value, whichever comes first, and stays slow up to the target pressure |
| Minimum / maximum diameter (31.4 / 52 mm) | Accepted window for the die diameter reached at the target pressure. A crimp ending outside it still completes but is counted as **Bad** and flagged OUT OF TOLERANCE |

The slow-down uses `MachineOutput.setClosingSpeed('FAST' | 'SLOW')`. In simulation the plant really slows down; with the log-only output it is logged. Real speed control is Phase 6.

**These four groups are my reading of the Uniflex screen** (the two dotted-arrow icons as a slow-down point, the two gauge icons as a diameter window). If the real meaning differs, the behaviour lives in `CrimpController.onSample` / `targetReached`.

### Screen sizes (7", 10", 12"+) and the crimp screen layout

Both crimp screens fit the screen without a scroll bar. The layout adapts to the screen:

| Screen | Typical size | What you get |
|--------|--------------|--------------|
| 7" | 800x480, 1024x600 | Below 960x590 the **compact layout**: one column, smaller controls, and the parameters and the three graphs on two tabs (PARAMETERS / GRAPHS) - START / STOP, the status and the live values stay visible on both. 1024x600 still has room for the standard layout and uses it. |
| 10" | 1280x800, 1280x720 | The standard layout at 1:1: parameters on the left, the three small graphs on the right. |
| 12"+ | 1366x768, 1920x1080, 2560x1440 ... | The standard layout **zoomed** (`shared/screen.ts`, `uiZoomFor`) so it looks like the 1366x768 design: 1920x1080 -> 1.4x, 2560x1440 -> 1.85x. Buttons, values and graphs get physically bigger on a big panel instead of leaving empty space. Set `CRIMP_UI_ZOOM=1.2` to force a zoom factor. |

The zoom follows the window size (a short window on a big screen is not zoomed) and the window never opens larger than the screen. The 4:3 industrial panels (1024x768, 1280x1024) use the standard layout.

Standard layout: live die diameter / displacement / pressure and the piece counters on top, the parameters in a three-column grid (die size and open diameter - with its TEACH button - in the same place in both modes; the target first), then the status and the big START / STOP buttons; the graphs are tap-to-expand tiles on the right. The parameter rows use the free height (up to a touch-friendly maximum) and shrink on short screens; long fault / error texts are cut to one line (full text on hover) and only one message line is shown. The other screens (recipes, history table, profile, guide) scroll if they do not fit.

### Dark / light mode

The sun / moon icon at the right of the header toggles the theme. Dark is the default (unchanged from before the toggle existed); the choice is remembered per device (`localStorage`, `crimp.theme`) and applied to every screen, including the graphs (`TraceChart.tsx` reads the active theme's CSS custom properties - `--text`, `--muted`, `--chart-axis`, `--chart-split`, `--chart-target` - and rebuilds the ECharts option on toggle, since a `<canvas>` chart cannot follow CSS `var()`s on its own). All theme colors are CSS custom properties in `styles.css` (`:root` = dark, `:root[data-theme="light"]` = light overrides); low-alpha tint backgrounds (`--accent-rgb`, `--red-rgb`, etc.) stay the same triplet in both themes and only the paired text/border colors invert, so badges and pills keep working as pale tints on either background.

### Screens, profiles and recipes

The app opens on a **home screen** with tiles: Crimp by pressure, Crimp by linear, Recipes, Guide / FAQ and Profile. The bottom bar (hidden on the home screen) has every option plus HOME, so any screen is one tap away.

- **Profile** - the Profile screen lists all profiles (with recipe and cycle counts); tap one to switch, or type a name under *New profile* to create one (it is selected straight away). Names are 1-30 characters, unique ignoring case. The first start seeds a `Default profile` (`SEED_PROFILES` in `shared/recipe.ts`). Recipes and cycle history are per profile, and the selected profile is remembered across restarts. Switching is blocked while a crimp is running. There are no passwords - a profile is a workspace, not a login.
- **Recipes** - the list screen shows each recipe's parameters and its production numbers (cycles, good, bad, last run), lets you load one into pressure mode (USE IN PRESSURE MODE) or delete it (two taps). Recipes are stored in the SQLite database (below). Deleting a recipe only hides it - its cycle history stays.
- **Recipe history** - each recipe card has a VIEW HISTORY button that opens a table of every cycle run with that recipe, newest first (100 rows at a time, LOAD MORE for older ones): finish time, result (GOOD / BAD / STOPPED / FAULT), target, final and at-target diameter, final / peak pressure, stroke, duration, hold, slow-down, whether the recipe values were edited, and notes (out of tolerance, rejected by operator, fault text). GOOD / BAD follow the same rule as the counters on the recipe card. The data comes from the `crimp_cycles` table.
- **Making a recipe** - run a crimp in CRIMP BY LINEAR; when it is COMPLETE a SAVE AS RECIPE button appears. The recipe stores, for CRIMP BY PRESSURE production: the pressure the crimp needed (target pressure), the diameter reached +/- a tolerance (accepted window, default 0.5 mm), slow-down at diameter + 6 mm or 20 % of the target pressure, and the die / open diameter / hold time of the linear job. Nothing is stored that the operator has not seen in the save dialog preview.
- **Pressure mode with a recipe** - the panel shows the loaded recipe; if you change a value it turns amber and RESTORE reloads the recipe.
- **Guide / FAQ** - grouped by topic (getting started, crimp screens, graphs, recipes and history, profiles, problems and safety); plain text in `src/renderer/data/faq.ts` - edit freely, keep it in step when a feature changes.

There is no on-screen keyboard in the app: the recipe name field needs the OS keyboard on the Pi touchscreen (or the default name can be kept).

### Database (SQLite)

Recipes and the history of every crimp cycle are stored in a **SQLite** file, opened by the Electron main process with `better-sqlite3` (synchronous, WAL mode). Default location: the app's user-data folder, `crimping.db` (on Windows `%APPDATA%\Crimping Machine Control\crimping.db`; override with `CRIMP_DB_PATH`). The Profile screen shows the exact path, or the error if the database could not be opened (the machine screens keep working without it).

| Table | Content |
| --- | --- |
| `profiles` | id (UUID; `default` for the seeded one), name, created time |
| `recipes` | one row per recipe: the eight pressure-mode parameters as columns, `origin_json` (what it was learned from), `deleted_at` (soft delete) |
| `crimp_cycles` | **one row per finished cycle** (COMPLETE, STOPPED or FAULT, both modes): profile, `recipe_id` + `recipe_name` snapshot + `recipe_modified` (operator changed a value), session id + cycle number, mode, result, start/finish time, duration, target, hold time, final and peak values, values at the moment the target was reached (pressure, stroke, diameter), slow-down engaged, within tolerance, operator-rejected count, fault message, parameters (JSON) |
| `cycle_samples` | the recorded curve of each cycle: JSON `[[t_ms, pressure_bar, displacement_mm], ...]` (about 10 KB per cycle; switch off with `HISTORY.logSamples` in `config.ts`) |

Schema changes are versioned migrations in `src/main/db/schema.ts` (`PRAGMA user_version`); never edit a shipped migration, append a new one. All SQL lives in `src/main/db/MachineStore.ts`; `CycleLogger` listens to the controller's `onCycleFinished` event and writes just after the cycle ends, so a database problem can never stop or fault a crimp.

A pressure cycle is filed under a recipe when that recipe is loaded when START is pressed. Pressing "+" (bad piece) marks the most recent logged cycle. Good = completed, inside tolerance and not rejected.

Handy queries (any SQLite tool, e.g. DB Browser for SQLite - open a copy while the app is running):

```sql
-- production numbers per recipe
SELECT recipe_name, COUNT(*) AS cycles,
       SUM(result = 'COMPLETE' AND within_tolerance IS NOT 0 AND operator_rejected = 0) AS good
FROM crimp_cycles WHERE recipe_id IS NOT NULL GROUP BY recipe_id;
-- the curve of one cycle
SELECT data FROM cycle_samples WHERE cycle_id = 42;
```

The renderer reaches it through `window.machine` (`listRecipes`, `saveRecipe`, `deleteRecipe`, `importRecipes`, `recipeStats`, `listCycles`, `getCycleSamples`); `listCycles` / `getCycleSamples` are ready for a history / export screen. Recipes made before the database existed (local storage) are imported automatically once.

`better-sqlite3` is a native module. `npm install` runs `electron-rebuild -f -o better-sqlite3` (postinstall; `-o` = only that module, `-w` would also rebuild the serial-port module), which downloads the prebuilt Electron binary for it (no compiler needed). If that download is blocked it falls back to compiling, which needs Python 3 and the Visual Studio "Desktop development with C++" build tools on Windows. If the step fails, `npm install` still finishes with a warning and the Profile screen shows the database error; re-run it with `npm run rebuild:native`. Only better-sqlite3 is rebuilt: the serial-port module ships prebuilt binaries that work in Electron as they are, and `npmRebuild` is off in the build config so packaging does not try to compile it again. Because of that it cannot be loaded by plain Node, so `npm run verify` tests the database code with Node's built-in `node:sqlite` (Node 22.5+; the database checks are skipped on older Node). On the Raspberry Pi run `npm install` and `npm run dist:pi` on the Pi itself (arm64).

### State machine

```
IDLE -> CRIMPING_LINEAR   -> TARGET_DISPLACEMENT_REACHED -> COMPLETE
IDLE -> CRIMPING_PRESSURE -> TARGET_PRESSURE_REACHED     -> COMPLETE
ANY STATE -> FAULT
```

- STOP during a cycle -> IDLE (data kept, result STOPPED). STOP in COMPLETE -> IDLE. In FAULT the button becomes RESET FAULT.
- Software faults only (not a safety system): sensor read failures / out-of-range signal (a 4-20 mA reading under 3.5 mA counts as a wire break), displacement or pressure above the hard ceiling, cycle timeout. Every fault commands the output off.
- Target detection needs `targetConfirmSamples` (default 2) consecutive samples at/over target so a single noisy sample cannot end the crimp.
- After the target is hit the output stops immediately, but recording continues for `targetReachedHoldMs` so the graph shows where the ram really stopped.

### Simulation

`SimulatedPlant` models the ram (accelerates, slows under load), a die-contact point after which pressure rises non-linearly with displacement (with hydraulic lag), and an automatic retract a moment after stopping. `MachineOutput.startClosing()/stopClosing()` drive it, so the control loop is genuinely closed. `SimulatedModbusClient` returns **raw ADC counts** with Gaussian noise and quantisation, so the whole raw -> volts -> engineering path runs exactly as it will with hardware.

## Connecting the real I/O module (Phase 5)

1. Edit `src/main/modbus/RegisterMap.ts`: slave ID, FC03 vs FC04, and the register address of each channel.
2. Edit `src/main/config.ts`: `SERIAL` (port, baud, parity), and for each sensor `rawFullScale` (counts the module reports at 10 V / 20 mA), `engMin`/`engMax` (0-10 V or 4-20 mA span) and `inputType` (`'0-10V'` or `'4-20mA'` for the pressure transducer).
3. `npm run dev:hw`. The header shows `Sensors OK - N Hz` (measured rate) or the exact error; the app keeps retrying the port if the adapter is unplugged.
4. Keep outputs disconnected. The real switch/solenoid layer is Phase 6 (`MachineOutput` is the seam for it).

**Rate note:** 100 Hz needs a baud rate of 38400 or more, because both channels are read in one Modbus request. At 9600 baud the bus tops out near 50 Hz - lower `TIMING.sampleRateHz` if so. The measured rate is always shown in the header.

## Deliberately not in v1

User accounts / passwords, deleting or renaming profiles, history / export screen, settings or calibration UI, cloud/remote, analytics, extra modes, physical output control, safety system.
