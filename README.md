# Crimping Machine Control (v1 prototype)

Electron + React + TypeScript app for a crimping machine. Two operating modes only:

- **CRIMP BY LINEAR** - closes until the linear transducer reaches the target displacement (mm).
- **CRIMP BY PRESSURE** - closes until the pressure transducer reaches the target pressure (bar).

Both transducers are read continuously in both modes, and pressure, displacement and time are recorded for the whole cycle. Live graphs: Pressure vs Time, Displacement vs Time, Pressure vs Displacement (the curve stays on screen after the cycle ends).

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
scripts/verify-sim.ts       headless end-to-end check
```

`window.machine`: `getSensors`, `getState`, `getCycleData`, `getAppInfo`, `startLinearCrimp(target)`, `startPressureCrimp(target)`, `stopCrimp`, `onTick(cb)`, `onState(cb)`.

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

Profiles/recipes, settings or calibration UI, users, database, cloud/remote, analytics, extra modes, physical output control, safety system.
