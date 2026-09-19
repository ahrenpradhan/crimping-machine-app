import type { MachineStatus } from '../../shared/types';

/** States in which the machine is closing and the cycle is being controlled. */
export const CRIMPING_STATES: ReadonlySet<MachineStatus> = new Set<MachineStatus>([
  'CRIMPING_LINEAR',
  'CRIMPING_PRESSURE',
]);

/** Short-lived states after the target is hit (output already stopped, still recording). */
export const REACHED_STATES: ReadonlySet<MachineStatus> = new Set<MachineStatus>([
  'TARGET_DISPLACEMENT_REACHED',
  'TARGET_PRESSURE_REACHED',
]);

/**
 * The whole machine, in one picture:
 *
 *   IDLE --start--> CRIMPING_LINEAR   --displacement >= target--> TARGET_DISPLACEMENT_REACHED --> COMPLETE
 *   IDLE --start--> CRIMPING_PRESSURE --pressure >= target------> TARGET_PRESSURE_REACHED ------> COMPLETE
 *
 *   any crimping state --stop--> IDLE          (data kept)
 *   COMPLETE / FAULT   --stop--> IDLE          (FAULT: stop = acknowledge)
 *   ANY STATE --sensor loss, limit, timeout--> FAULT
 */
export function isCrimping(status: MachineStatus): boolean {
  return CRIMPING_STATES.has(status);
}

export function isBusy(status: MachineStatus): boolean {
  return CRIMPING_STATES.has(status) || REACHED_STATES.has(status);
}
