import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * useState that survives app restarts (localStorage - a per-machine
 * convenience for operator settings; there is no database in v1).
 * `sanitize` validates whatever was stored; return null to fall back to `initial`.
 * Every storage access is wrapped so a blocked/corrupt store can never break the UI.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
  sanitize: (stored: unknown) => T | null,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const clean = sanitize(JSON.parse(raw));
        if (clean !== null) return clean;
      }
    } catch {
      // ignore - use the default
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore - not persisted
    }
  }, [key, value]);

  return [value, setValue];
}
