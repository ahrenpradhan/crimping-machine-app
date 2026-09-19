import type { AnalogChannel, ConnectionStatus } from '../../shared/types';
import { SERIAL } from '../config';
import { REGISTER_MAP, type RegisterMap } from './RegisterMap';

/**
 * What the rest of the app knows about "the I/O module".
 * Implemented by the real RS485 client below AND by the simulator, so
 * SensorManager never cares which one it is talking to.
 * Nothing in the renderer/React ever touches this.
 */
export interface IModbusClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Read one raw 16-bit register. */
  readRegister(address: number): Promise<number>;
  /** Read the raw ADC count of one analog channel (address comes from RegisterMap). */
  readAnalogInput(channel: AnalogChannel): Promise<number>;
  /** Read BOTH analog channels, in one bus transaction when possible. */
  readAnalogInputs(): Promise<Record<AnalogChannel, number>>;

  getConnectionStatus(): ConnectionStatus;
}

export type SerialSettings = Pick<
  typeof SERIAL,
  'path' | 'baudRate' | 'parity' | 'dataBits' | 'stopBits' | 'timeoutMs'
>;

/**
 * Modbus RTU over RS485 (USB-RS485 adapter) using the `modbus-serial` package.
 * The package is loaded lazily so simulation mode never touches the native
 * serial-port bindings.
 */
export class ModbusClient implements IModbusClient {
  // Typed loosely on purpose: modbus-serial is only loaded when hardware is used.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rtu: any = null;
  private status: ConnectionStatus = 'disconnected';
  private lastError: string | null = null;

  constructor(
    private readonly serial: SerialSettings = SERIAL,
    private readonly map: RegisterMap = REGISTER_MAP,
  ) {}

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') return;
    this.status = 'connecting';
    try {
      const mod = await import('modbus-serial');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ModbusRTU = (mod as any).default ?? mod;
      const rtu = new ModbusRTU();
      await rtu.connectRTUBuffered(this.serial.path, {
        baudRate: this.serial.baudRate,
        dataBits: this.serial.dataBits,
        stopBits: this.serial.stopBits,
        parity: this.serial.parity,
      });
      rtu.setID(this.map.slaveId);
      rtu.setTimeout(this.serial.timeoutMs);
      // Adapter unplugged -> mark disconnected so SensorManager starts reconnecting.
      rtu.on?.('close', () => {
        this.status = 'disconnected';
      });
      rtu.on?.('error', (err: Error) => {
        this.lastError = err.message;
      });
      this.rtu = rtu;
      this.lastError = null;
      this.status = 'connected';
    } catch (err) {
      this.rtu = null;
      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      throw new Error(`Modbus connect failed (${this.serial.path}): ${this.lastError}`);
    }
  }

  async disconnect(): Promise<void> {
    const rtu = this.rtu;
    this.rtu = null;
    this.status = 'disconnected';
    if (!rtu) return;
    await new Promise<void>((resolve) => {
      try {
        rtu.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  async readRegister(address: number): Promise<number> {
    const data = await this.readRegisters(address, 1);
    return data[0];
  }

  async readAnalogInput(channel: AnalogChannel): Promise<number> {
    return this.readRegister(this.map.analogInputs[channel].address);
  }

  async readAnalogInputs(): Promise<Record<AnalogChannel, number>> {
    const dispAddr = this.map.analogInputs.displacement.address;
    const presAddr = this.map.analogInputs.pressure.address;
    const lo = Math.min(dispAddr, presAddr);
    const hi = Math.max(dispAddr, presAddr);

    if (hi - lo + 1 <= this.map.maxBlockSpan) {
      // One request for both channels.
      const block = await this.readRegisters(lo, hi - lo + 1);
      return {
        displacement: block[dispAddr - lo],
        pressure: block[presAddr - lo],
      };
    }
    const displacement = await this.readRegister(dispAddr);
    const pressure = await this.readRegister(presAddr);
    return { displacement, pressure };
  }

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  private async readRegisters(start: number, count: number): Promise<number[]> {
    if (!this.rtu || this.status !== 'connected') {
      throw new Error('Modbus not connected');
    }
    try {
      const result =
        this.map.readFunction === 'input'
          ? await this.rtu.readInputRegisters(start, count)
          : await this.rtu.readHoldingRegisters(start, count);
      return result.data as number[];
    } catch (err) {
      // A closed port means the adapter went away; a timeout does not.
      if (this.rtu && this.rtu.isOpen === false) this.status = 'disconnected';
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
