import { useCallback, useEffect, useState } from 'react';
import type { Profile } from '../../shared/recipe';
import type { ProfileSummary } from '../../shared/types';

export type CreateProfileResult = { ok: true; profile: Profile } | { ok: false; error: string };

export interface ProfilesApi {
  profiles: ProfileSummary[];
  /** The first read from the database has finished (successfully or not). */
  loaded: boolean;
  /** Database error text, or null. */
  error: string | null;
  reload: () => Promise<void>;
  create: (name: string) => Promise<CreateProfileResult>;
}

/** The list of profiles, stored in SQLite by the main process. */
export function useProfiles(): ProfilesApi {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const res = await window.machine.listProfiles();
      if (res.ok) {
        setProfiles(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Database error');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (name: string): Promise<CreateProfileResult> => {
      const res = await window.machine.createProfile(name);
      if (!res.ok) return { ok: false, error: res.error };
      await reload();
      return { ok: true, profile: res.data };
    },
    [reload],
  );

  return { profiles, loaded, error, reload, create };
}
