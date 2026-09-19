import { useCallback, useEffect, useRef, useState } from 'react';
import type { Recipe } from '../../shared/recipe';
import type { CycleLogEntry, RecipeStats } from '../../shared/types';
import { cycleNote, cycleVerdict, type Verdict } from '../utils/history';

interface Props {
  recipe: Recipe;
  /** Totals from the database (the table below may hold fewer rows until "load more"). */
  stat: RecipeStats | undefined;
  onClose: () => void;
}

const PAGE = 100;

const fmtWhen = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

const num = (v: number | null | undefined, digits: number): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(digits);

const VERDICT_LABEL: Record<Verdict, string> = { GOOD: 'GOOD', BAD: 'BAD', STOPPED: 'STOPPED', FAULT: 'FAULT' };

/** Every crimp cycle that ran with one recipe, newest first, as a table. */
export function RecipeHistory({ recipe, stat, onClose }: Props) {
  const [rows, setRows] = useState<CycleLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const rowsRef = useRef<CycleLogEntry[]>([]);
  rowsRef.current = rows;

  /** offset 0 = (re)load from the top, otherwise append the next page. */
  const load = useCallback(
    async (offset: number): Promise<void> => {
      setLoading(true);
      try {
        const res = await window.machine.listCycles({
          profileId: recipe.profileId,
          recipeId: recipe.id,
          limit: PAGE,
          offset,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setError(null);
        setRows(offset === 0 ? res.data : [...rowsRef.current, ...res.data]);
        setHasMore(res.data.length === PAGE);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Database error');
      } finally {
        setLoading(false);
      }
    },
    [recipe.id, recipe.profileId],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <div className="screen screen--fill">
      <div className="screen__head">
        <h2>History - {recipe.name}</h2>
        <div className="head-actions">
          <button type="button" className="ghost-btn" disabled={loading} onClick={() => void load(0)}>
            REFRESH
          </button>
          <button type="button" className="ghost-btn" onClick={onClose}>
            BACK TO RECIPES
          </button>
        </div>
      </div>

      {error && <div className="db-error">Database problem: {error}</div>}

      <div className="history__summary">
        <div>
          <span>Cycles</span>
          <b>{stat?.cycles ?? rows.length}</b>
        </div>
        <div>
          <span>Good</span>
          <b className="ok">{stat?.good ?? '-'}</b>
        </div>
        <div>
          <span>Bad</span>
          <b className="bad">{stat?.bad ?? '-'}</b>
        </div>
        <div>
          <span>Last run</span>
          <b>{rows.length > 0 ? fmtWhen(rows[0].finishedAt) : '-'}</b>
        </div>
      </div>

      {!loading && !error && rows.length === 0 ? (
        <div className="empty">
          <b>No cycles yet.</b>
          <p>
            Load this recipe with <b>USE IN PRESSURE MODE</b> and run a crimp - every cycle is
            recorded here.
          </p>
        </div>
      ) : (
        <div className="history__scroll">
          <table className="history">
            <thead>
              <tr>
                <th className="history__sticky">#</th>
                <th>Finished</th>
                <th>Result</th>
                <th className="num">Target (bar)</th>
                <th className="num">Final Ø (mm)</th>
                <th className="num">Ø at target (mm)</th>
                <th className="num">Final (bar)</th>
                <th className="num">Peak (bar)</th>
                <th className="num">Stroke (mm)</th>
                <th className="num">Duration (s)</th>
                <th className="num">Hold (s)</th>
                <th>Slow-down</th>
                <th>Recipe values</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const verdict = cycleVerdict(c);
                return (
                  <tr key={c.id} className={`history__row history__row--${verdict.toLowerCase()}`}>
                    <td className="history__sticky">{c.cycleNumber}</td>
                    <td className="nowrap">{fmtWhen(c.finishedAt)}</td>
                    <td>
                      <span className={`verdict verdict--${verdict.toLowerCase()}`}>{VERDICT_LABEL[verdict]}</span>
                    </td>
                    <td className="num">{num(c.target, 1)}</td>
                    <td className="num">{num(c.finalDiameterMm, 2)}</td>
                    <td className="num">{num(c.atTargetDiameterMm, 2)}</td>
                    <td className="num">{num(c.finalPressureBar, 1)}</td>
                    <td className="num">{num(c.peakPressureBar, 1)}</td>
                    <td className="num">{num(c.finalDisplacementMm, 2)}</td>
                    <td className="num">{num(c.durationMs / 1000, 2)}</td>
                    <td className="num">{num(c.holdTimeMs / 1000, 1)}</td>
                    <td>{c.slowEngaged ? 'Yes' : 'No'}</td>
                    <td>{c.recipeModified ? <span className="verdict verdict--edited">EDITED</span> : 'As saved'}</td>
                    <td className="history__note">{cycleNote(c) || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading && <div className="history__loading">Loading...</div>}
          {hasMore && !loading && (
            <button type="button" className="ghost-btn history__more" onClick={() => void load(rows.length)}>
              LOAD MORE
            </button>
          )}
        </div>
      )}
    </div>
  );
}
