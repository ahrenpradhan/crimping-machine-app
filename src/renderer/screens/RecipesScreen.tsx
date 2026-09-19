import { useState } from 'react';
import type { Recipe } from '../../shared/recipe';
import type { RecipeStats } from '../../shared/types';
import { ConfirmButton } from '../components/ConfirmButton';
import { RecipeHistory } from '../components/RecipeHistory';

interface Props {
  recipes: Recipe[];
  /** Cycle history numbers per recipe id (from the database). */
  stats: Record<string, RecipeStats>;
  /** Database error, if the recipes could not be read/written. */
  error: string | null;
  activeRecipeId: string | null;
  /** Loading a recipe changes the pressure parameters, so it waits for a running cycle. */
  busy: boolean;
  onUse: (recipe: Recipe) => void;
  onDelete: (recipe: Recipe) => void;
  onBack: () => void;
}

const fmtDate = (ms: number): string =>
  ms > 0 ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-';

/** List of stored recipes (CRIMP BY PRESSURE parameter sets) for the active profile. */
export function RecipesScreen({ recipes, stats, error, activeRecipeId, busy, onUse, onDelete, onBack }: Props) {
  /** Recipe whose cycle history table is open (null = the recipe list). */
  const [historyId, setHistoryId] = useState<string | null>(null);
  const historyRecipe = historyId === null ? null : (recipes.find((r) => r.id === historyId) ?? null);

  if (historyRecipe) {
    return <RecipeHistory recipe={historyRecipe} stat={stats[historyRecipe.id]} onClose={() => setHistoryId(null)} />;
  }

  return (
    <div className="screen">
      <div className="screen__head">
        <h2>Recipes</h2>
        <button type="button" className="ghost-btn" onClick={onBack}>
          BACK
        </button>
      </div>

      {error && (
        <div className="db-error">
          Database problem: {error}
        </div>
      )}

      {recipes.length === 0 ? (
        <div className="empty">
          <b>No recipes yet.</b>
          <p>
            Run a crimp in CRIMP BY LINEAR. When it completes, press <b>SAVE AS RECIPE</b> under
            the status - the recipe then appears here for production in CRIMP BY PRESSURE.
          </p>
        </div>
      ) : (
        <ul className="recipes">
          {recipes.map((r) => {
            const active = r.id === activeRecipeId;
            const p = r.pressure;
            const st = stats[r.id];
            return (
              <li key={r.id} className={`recipe${active ? ' is-active' : ''}`}>
                <div className="recipe__main">
                  <div className="recipe__title">
                    {r.name}
                    {active && <em className="recipe__tag">IN USE</em>}
                    {r.origin && <em className="recipe__tag recipe__tag--soft">FROM LINEAR CRIMP</em>}
                  </div>
                  <div className="recipe__grid">
                    <span>Target pressure</span>
                    <b>{p.targetPressureBar.toFixed(1)} bar</b>
                    <span>Accepted diameter</span>
                    <b>
                      {p.minDiameterMm.toFixed(2)} - {p.maxDiameterMm.toFixed(2)} mm
                    </b>
                    <span>Die / open diameter</span>
                    <b>
                      {p.dieSizeMm} mm / {p.openDiameterMm.toFixed(1)} mm
                    </b>
                    <span>Slow down at</span>
                    <b>
                      {p.slowSwitchDiameterMm.toFixed(1)} mm or {p.slowSwitchPressureBar} bar
                    </b>
                    <span>Hold time</span>
                    <b>{p.holdTimeSec.toFixed(1)} s</b>
                  </div>
                  <div className="recipe__usage">
                    {st && st.cycles > 0 ? (
                      <>
                        <b>{st.cycles}</b> cycles - <span className="ok">{st.good} good</span> -{' '}
                        <span className="bad">{st.bad} bad</span> - last run {fmtDate(st.lastRunAt ?? 0)}
                      </>
                    ) : (
                      'Not used in production yet'
                    )}
                  </div>
                  <div className="recipe__meta">
                    Saved {fmtDate(r.createdAt)}
                    {r.origin &&
                      ` - learned from Ø${r.origin.diameterMm.toFixed(2)} mm at ${r.origin.pressureBar.toFixed(1)} bar`}
                  </div>
                </div>
                <div className="recipe__actions">
                  <button
                    type="button"
                    className="btn btn--start recipe__use"
                    disabled={busy}
                    onClick={() => onUse(r)}
                  >
                    USE IN PRESSURE MODE
                  </button>
                  <button type="button" className="ghost-btn" onClick={() => setHistoryId(r.id)}>
                    VIEW HISTORY
                  </button>
                  <ConfirmButton
                    className="ghost-btn ghost-btn--danger"
                    label="DELETE"
                    confirmLabel="TAP AGAIN - DELETE"
                    onConfirm={() => onDelete(r)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
