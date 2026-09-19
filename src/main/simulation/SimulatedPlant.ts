/**
 * A tiny physical model of the crimping press, used in simulation mode.
 *
 *   closing  -> ram advances (slowing down as load builds)
 *   contact  -> once the die touches the workpiece pressure rises non-linearly
 *   stopped  -> position and pressure hold
 *   later    -> ram retracts on its own (stands in for the operator opening the die)
 *
 * MachineOutput.startClosing()/stopClosing() drive `setClosing()`, so the
 * controller's target detection is a genuine closed loop even without hardware.
 */
export interface PlantParams {
  closeSpeedMmS: number;
  /** Closing speed after the pressure mode's slow-down point. */
  slowSpeedMmS: number;
  accelMmS2: number;
  decelMmS2: number;
  /** Die touches the workpiece at this displacement. */
  contactMm: number;
  /** Pressure needed just to move the ram (no workpiece load). */
  freeTravelBar: number;
  /** Pressure when the machine is resting at home. */
  restBar: number;
  /** Workpiece curve: pressure = freeTravel + stiffness * (x - contact)^exponent. */
  stiffness: number;
  exponent: number;
  /** Hydraulic lag: time constant of the pressure response. */
  pressureTauS: number;
  holdBeforeRetractS: number;
  retractSpeedMmS: number;
  maxTravelMm: number;
}

// Tuned so the default job (74 mm open -> 32.2 mm target = ~41.8 mm stroke)
// builds roughly 270 bar, and a 320 bar target lands near 44 mm of stroke.
// The die touches the workpiece at 22 mm stroke (= 52 mm diameter).
export const DEFAULT_PLANT_PARAMS: PlantParams = {
  closeSpeedMmS: 15,
  slowSpeedMmS: 6,
  accelMmS2: 120,
  decelMmS2: 400,
  contactMm: 22,
  freeTravelBar: 6,
  restBar: 1.5,
  stiffness: 5.5,
  exponent: 1.3,
  pressureTauS: 0.04,
  holdBeforeRetractS: 1.5,
  retractSpeedMmS: 30,
  maxTravelMm: 50,
};

export class SimulatedPlant {
  displacementMm = 0;
  pressureBar: number;
  velocityMmS = 0;

  private closing = false;
  private slow = false;
  private idleTimeS = 0;

  constructor(private readonly p: PlantParams = DEFAULT_PLANT_PARAMS) {
    this.pressureBar = p.restBar;
  }

  setClosing(closing: boolean): void {
    this.closing = closing;
    if (closing) this.idleTimeS = 0;
  }

  setSlow(slow: boolean): void {
    this.slow = slow;
  }

  isClosing(): boolean {
    return this.closing;
  }

  /** Advance the model by `dt` seconds. */
  step(dt: number): void {
    const p = this.p;
    let retracting = false;

    if (this.closing) {
      // Ram slows as the load (pressure) builds up.
      const load = 1 - 0.5 * Math.min(1, this.pressureBar / 500);
      const targetVelocity = (this.slow ? p.slowSpeedMmS : p.closeSpeedMmS) * load;
      const maxDelta = p.accelMmS2 * dt;
      const delta = targetVelocity - this.velocityMmS;
      this.velocityMmS += Math.max(-maxDelta, Math.min(maxDelta, delta));
    } else if (this.velocityMmS > 0) {
      this.velocityMmS = Math.max(0, this.velocityMmS - p.decelMmS2 * dt);
    } else {
      this.idleTimeS += dt;
      retracting = this.idleTimeS > p.holdBeforeRetractS && this.displacementMm > 0;
    }

    if (retracting) {
      this.displacementMm = Math.max(0, this.displacementMm - p.retractSpeedMmS * dt);
    } else {
      this.displacementMm += this.velocityMmS * dt;
    }
    this.displacementMm = Math.min(p.maxTravelMm, Math.max(0, this.displacementMm));

    let targetPressure: number;
    if (!this.closing && this.displacementMm <= 0.001) {
      targetPressure = p.restBar;
    } else if (retracting) {
      targetPressure =
        this.displacementMm > p.contactMm ? 0.85 * this.crimpCurve(this.displacementMm) : p.restBar;
    } else {
      targetPressure = this.crimpCurve(this.displacementMm);
    }
    // First-order hydraulic lag.
    this.pressureBar += (targetPressure - this.pressureBar) * (1 - Math.exp(-dt / p.pressureTauS));
  }

  private crimpCurve(x: number): number {
    const p = this.p;
    const d = x - p.contactMm;
    return d > 0 ? p.freeTravelBar + p.stiffness * Math.pow(d, p.exponent) : p.freeTravelBar;
  }
}

/** Standard normal random number (Box-Muller). */
export function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
