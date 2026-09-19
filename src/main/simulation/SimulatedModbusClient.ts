import type { AnalogChannel, ConnectionStatus } from '../../shared/types';
import type { IModbusClient } from '../modbus/ModbusClient';
import { REGISTER_MAP } from '../modbus/RegisterMap';
import { LinearSensor } from '../sensors/LinearSensor';
import { PressureSensor } from '../sensors/PressureSensor';
import { gaussian, type SimulatedPlant } from './SimulatedPlant';

export interface SimNoise {
  displacementMm: number;
  pressureBar: number;
}

/**
 * Drop-in replacement for the real Modbus client. It runs the plant model and
 * returns RAW ADC COUNTS (with sensor noise and quantisation), so the whole
 * raw -> volts -> engineering path in SensorManager is exercised exactly as it
 * will be with hardware.
 */
export class SimulatedModbusClient implements IModbusClient {
  private status: ConnectionStatus = 'disconnected';
  private lastStep = performance.now();

  constructor(
    private readonly plant: SimulatedPlant,
    private readonly linear: LinearSensor = new LinearSensor(),
    private readonly pressure: PressureSensor = new PressureSensor(),
    private readonly noise: SimNoise = { displacementMm: 0.015, pressureBar: 0.5 },
  ) {}

  async connect(): Promise<void> {
    this.status = 'connected';
    this.lastStep = performance.now();
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
  }

  async readRegister(address: number): Promise<number> {
    this.advance();
    const { displacement, pressure } = REGISTER_MAP.analogInputs;
    if (address === displacement.address) return this.rawDisplacement();
    if (address === pressure.address) return this.rawPressure();
    throw new Error(`Simulated register ${address} is not mapped`);
  }

  async readAnalogInput(channel: AnalogChannel): Promise<number> {
    this.advance();
    return channel === 'displacement' ? this.rawDisplacement() : this.rawPressure();
  }

  async readAnalogInputs(): Promise<Record<AnalogChannel, number>> {
    this.advance();
    return { displacement: this.rawDisplacement(), pressure: this.rawPressure() };
  }

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  /** Step the plant by real elapsed time, in small sub-steps for stability. */
  private advance(): void {
    const now = performance.now();
    let dt = Math.min((now - this.lastStep) / 1000, 0.25);
    this.lastStep = now;
    while (dt > 0) {
      const h = Math.min(dt, 0.005);
      this.plant.step(h);
      dt -= h;
    }
  }

  private rawDisplacement(): number {
    return this.linear.engineeringToRaw(
      this.plant.displacementMm + gaussian() * this.noise.displacementMm,
    );
  }

  private rawPressure(): number {
    return this.pressure.engineeringToRaw(
      this.plant.pressureBar + gaussian() * this.noise.pressureBar,
    );
  }
}
