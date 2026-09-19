import type { MachineStatus } from '../../shared/types';

export const STATUS_LABEL: Record<MachineStatus, string> = {
  IDLE: 'IDLE',
  CRIMPING_LINEAR: 'CRIMPING (LINEAR)',
  TARGET_DISPLACEMENT_REACHED: 'TARGET DISPLACEMENT REACHED',
  CRIMPING_PRESSURE: 'CRIMPING (PRESSURE)',
  TARGET_PRESSURE_REACHED: 'TARGET PRESSURE REACHED',
  COMPLETE: 'COMPLETE',
  FAULT: 'FAULT',
};

/** CSS modifier for the status badge. */
export function statusTone(status: MachineStatus): 'idle' | 'running' | 'reached' | 'complete' | 'fault' {
  switch (status) {
    case 'CRIMPING_LINEAR':
    case 'CRIMPING_PRESSURE':
      return 'running';
    case 'TARGET_DISPLACEMENT_REACHED':
    case 'TARGET_PRESSURE_REACHED':
      return 'reached';
    case 'COMPLETE':
      return 'complete';
    case 'FAULT':
      return 'fault';
    default:
      return 'idle';
  }
}

/** Closing, or just reached the target (controls locked). */
export function isBusyStatus(status: MachineStatus): boolean {
  return (
    status === 'CRIMPING_LINEAR' ||
    status === 'CRIMPING_PRESSURE' ||
    status === 'TARGET_DISPLACEMENT_REACHED' ||
    status === 'TARGET_PRESSURE_REACHED'
  );
}
