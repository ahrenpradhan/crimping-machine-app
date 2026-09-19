import type { SensorCalibration } from '../../shared/types';
import { LINEAR_SENSOR } from '../config';
import { AnalogSensor } from './AnalogSensor';

/** Linear transducer: raw ADC -> volts -> displacement in mm. */
export class LinearSensor extends AnalogSensor {
  constructor(calibration: SensorCalibration = LINEAR_SENSOR) {
    super('Linear transducer', calibration);
  }
}
