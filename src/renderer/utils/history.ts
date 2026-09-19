import type { CycleLogEntry } from '../../shared/types';

export type Verdict = 'GOOD' | 'BAD' | 'STOPPED' | 'FAULT';

/**
 * Same rule as the recipe statistics in the database (MachineStore.recipeStats):
 * good = completed, diameter inside the accepted window (or not checked) and not
 * marked bad by the operator; bad = completed but out of tolerance or rejected.
 */
export function cycleVerdict(c: CycleLogEntry): Verdict {
  if (c.result === 'FAULT') return 'FAULT';
  if (c.result === 'STOPPED') return 'STOPPED';
  return c.withinTolerance === false || c.operatorRejected > 0 ? 'BAD' : 'GOOD';
}

/** Why a cycle was not good (empty for a good one). */
export function cycleNote(c: CycleLogEntry): string {
  const parts: string[] = [];
  if (c.faultMessage) parts.push(c.faultMessage);
  if (c.withinTolerance === false) parts.push('Diameter out of tolerance');
  if (c.operatorRejected > 0) {
    parts.push(c.operatorRejected > 1 ? `Rejected by operator x${c.operatorRejected}` : 'Rejected by operator');
  }
  return parts.join(' - ');
}
