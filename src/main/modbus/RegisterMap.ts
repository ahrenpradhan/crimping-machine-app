import type { AnalogChannel } from '../../shared/types';

/**
 * Modbus register map of the analog input module.
 *
 * This is the ONLY file that knows register addresses. The values below are
 * PLACEHOLDERS - replace them with the real ones from your I/O module's
 * manual (slave ID, function code, which register holds which channel).
 */
export type ModbusReadFunction = 'holding' | 'input';

export interface RegisterMap {
  /** Modbus slave / unit ID of the I/O module. */
  slaveId: number;
  /** FC03 ('holding') or FC04 ('input') - which one returns the ADC values. */
  readFunction: ModbusReadFunction;
  /** Register address per analog channel (0-based protocol address). */
  analogInputs: Record<AnalogChannel, { address: number; description: string }>;
  /**
   * If both channel registers lie within this many registers of each other they
   * are fetched with ONE request (needed to reach 100 Hz on a slow RS485 bus).
   */
  maxBlockSpan: number;
}

export const REGISTER_MAP: RegisterMap = {
  slaveId: 1,
  readFunction: 'holding',
  analogInputs: {
    displacement: { address: 0, description: 'AI1 - linear transducer (0-10 V)' },
    pressure: { address: 1, description: 'AI2 - pressure transducer (0-10 V or 4-20 mA)' },
  },
  maxBlockSpan: 8,
};
