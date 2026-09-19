import type { SensorCalibration } from '../../shared/types';
import { PRESSURE_SENSOR } from '../config';
import { AnalogSensor } from './AnalogSensor';

/** Pressure transducer: raw ADC -> volts (0-10 V) or mA (4-20 mA) -> bar. */
export class PressureSensor extends AnalogSensor {
  constructor(calibration: SensorCalibration = PRESSURE_SENSOR) {
    super('Pressure transducer', calibration);
  }
}
