import { useCallback, useEffect, useState } from 'react';
import { coerceRecipes, type Recipe } from '../../shared/recipe';
import type { RecipeStats } from '../../shared/types';

const LEGACY_KEY = 'crimp.recipes.v1';

/**
 * Recipes made before the SQLite database existed were kept in local storage.
 * Move them into the database once, then forget them.
 */
async function migrateLegacyRecipes(): Promise<void> {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw === null) return;
    const recipes = coerceRecipes(JSON.parse(raw)) ?? [];
    if (recipes.length > 0) {
      const res = await window.machine.importRecipes(recipes);
      if (!res.ok) return; // keep them; try again next start
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore - nothing to migrate
  }
}

export interface RecipesApi {
  recipes: Recipe[];
  /** Cycles / good / bad / last run per recipe id (from the cycle history). */
  stats: Record<string, RecipeStats>;
  /** Database error text, or null. */
  error: string | null;
  /** Re-reads recipes and stats from the database. */
  reload: () => Promise<void>;
  save: (recipe: Recipe) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

/** Recipes of one profile, stored in SQLite by the main process. */
export function useRecipes(profileId: string): RecipesApi {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [stats, setStats] = useState<Record<string, RecipeStats>>({});
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [r, s] = await Promise.all([
        window.machine.listRecipes(profileId),
        window.machine.recipeStats(profileId),
      ]);
      if (r.ok) {
        setRecipes(r.data);
        setError(null);
      } else {
        setError(r.error);
      }
      if (s.ok) setStats(s.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Database error');
    }
  }, [profileId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await migrateLegacyRecipes();
      if (alive) await reload();
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  const save = useCallback(
    async (recipe: Recipe): Promise<boolean> => {
      const res = await window.machine.saveRecipe(recipe);
      if (!res.ok) setError(res.error);
      await reload();
      return res.ok;
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const res = await window.machine.deleteRecipe(id);
      if (!res.ok) setError(res.error);
      await reload();
      return res.ok;
    },
    [reload],
  );

  return { recipes, stats, error, reload, save, remove };
}
