import type { SensorCalibration } from '../../shared/types';

/** Raised when a raw value implies an impossible signal (wire break, over-range). */
export class SensorRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SensorRangeError';
  }
}

const ELECTRICAL_FULL_SCALE = { '0-10V': 10, '4-20mA': 20 } as const;

/**
 * Base class for an analog transducer:
 *   ADC counts -> electrical signal (V or mA) -> engineering unit.
 * Also provides the inverse so the simulator can emit realistic raw counts.
 */
export abstract class AnalogSensor {
  constructor(
    readonly name: string,
    protected readonly cal: SensorCalibration,
  ) {}

  get inputType(): SensorCalibration['inputType'] {
    return this.cal.inputType;
  }

  /** Raw counts -> volts (0-10 V input) or milliamps (4-20 mA input). */
  rawToElectrical(raw: number): number {
    return (raw / this.cal.rawFullScale) * ELECTRICAL_FULL_SCALE[this.cal.inputType];
  }

  /** Electrical signal -> engineering value (mm or bar). */
  electricalToEngineering(electrical: number): number {
    const { inputType, engMin, engMax, zeroOffset } = this.cal;
    const fraction = inputType === '0-10V' ? electrical / 10 : (electrical - 4) / 16;
    return engMin + fraction * (engMax - engMin) + zeroOffset;
  }

  /** Full conversion with validation. Throws SensorRangeError on a bad signal. */
  convert(raw: number): { electrical: number; value: number } {
    if (!Number.isFinite(raw)) {
      throw new SensorRangeError(`${this.name}: invalid reading`);
    }
    const electrical = this.rawToElectrical(raw);
    this.checkRange(electrical);
    return { electrical, value: this.electricalToEngineering(electrical) };
  }

  /** Inverse of `convert` (used by the simulator). Result is a clamped integer. */
  engineeringToRaw(value: number): number {
    const { inputType, engMin, engMax, zeroOffset, rawFullScale } = this.cal;
    const fraction = (value - zeroOffset - engMin) / (engMax - engMin);
    const electrical = inputType === '0-10V' ? fraction * 10 : 4 + fraction * 16;
    const raw = Math.round((electrical / ELECTRICAL_FULL_SCALE[inputType]) * rawFullScale);
    return Math.min(65535, Math.max(0, raw));
  }

  protected checkRange(electrical: number): void {
    if (this.cal.inputType === '0-10V') {
      if (electrical < -0.25 || electrical > 10.5) {
        throw new SensorRangeError(
          `${this.name}: ${electrical.toFixed(2)} V is outside 0-10 V (check wiring)`,
        );
      }
    } else {
      // 4-20 mA is "live zero": below ~3.5 mA means a broken wire, not 0.
      if (electrical < 3.5) {
        throw new SensorRangeError(
          `${this.name}: ${electrical.toFixed(2)} mA is below 4 mA (wire break?)`,
        );
      }
      if (electrical > 21.5) {
        throw new SensorRangeError(
          `${this.name}: ${electrical.toFixed(2)} mA is above 20 mA (over-range)`,
        );
      }
    }
  }
}
