/**
 * Abstraction for the machine's "close" output.
 *
 * v1: NO physical switch / solenoid control. The real implementation is
 * deliberately not written yet (Phase 6) - these classes only log, or drive the
 * simulator. A software output is never a substitute for hard-wired safety.
 */
export type ClosingSpeed = 'FAST' | 'SLOW';

export interface MachineOutput {
  /** Starts closing at FAST speed. */
  startClosing(): void;
  /** Changes speed while closing (used for the pressure mode's slow-down point). */
  setClosingSpeed(speed: ClosingSpeed): void;
  stopClosing(): void;
  isClosing(): boolean;
}

/** Logs only. Used when running against real sensors with outputs disconnected. */
export class LogMachineOutput implements MachineOutput {
  private closing = false;

  startClosing(): void {
    if (this.closing) return;
    this.closing = true;
    console.log('[MachineOutput] START CLOSING');
  }

  setClosingSpeed(speed: ClosingSpeed): void {
    if (this.closing) console.log(`[MachineOutput] CLOSING SPEED ${speed}`);
  }

  stopClosing(): void {
    if (!this.closing) return;
    this.closing = false;
    console.log('[MachineOutput] STOP CLOSING');
  }

  isClosing(): boolean {
    return this.closing;
  }
}

/** Logs and drives the simulated plant so the control loop is closed in simulation. */
export class SimulatedMachineOutput implements MachineOutput {
  private closing = false;

  constructor(
    private readonly plant: { setClosing(closing: boolean): void; setSlow(slow: boolean): void },
  ) {}

  startClosing(): void {
    if (this.closing) return;
    this.closing = true;
    this.plant.setSlow(false);
    this.plant.setClosing(true);
    console.log('[MachineOutput:SIM] START CLOSING');
  }

  setClosingSpeed(speed: ClosingSpeed): void {
    if (!this.closing) return;
    this.plant.setSlow(speed === 'SLOW');
    console.log(`[MachineOutput:SIM] CLOSING SPEED ${speed}`);
  }

  stopClosing(): void {
    if (!this.closing) return;
    this.closing = false;
    this.plant.setClosing(false);
    console.log('[MachineOutput:SIM] STOP CLOSING');
  }

  isClosing(): boolean {
    return this.closing;
  }
}
