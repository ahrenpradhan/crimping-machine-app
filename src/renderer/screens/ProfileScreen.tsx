import { useState } from 'react';
import { MAX_PROFILE_NAME_LENGTH } from '../../shared/recipe';
import type { AppInfo, ProfileSummary } from '../../shared/types';

interface Props {
  profiles: ProfileSummary[];
  activeProfileId: string;
  /** A cycle is running: switching profile waits until it is finished. */
  busy: boolean;
  /** Database error, if profiles could not be read. */
  error: string | null;
  info: AppInfo | null;
  onSelect: (id: string) => void;
  /** Resolves to an error text, or null when the profile was created. */
  onCreate: (name: string) => Promise<string | null>;
  onBack: () => void;
}

/**
 * Profile select + create. Recipes and the cycle history are kept per profile,
 * so a profile is a separate "workspace" (for example one per shift, customer or product line).
 */
export function ProfileScreen({ profiles, activeProfileId, busy, error, info, onSelect, onCreate, onBack }: Props) {
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const submit = async (): Promise<void> => {
    setCreating(true);
    setFormError(null);
    const problem = await onCreate(name);
    setCreating(false);
    if (problem) setFormError(problem);
    else setName('');
  };

  return (
    <div className="screen">
      <div className="screen__head">
        <h2>Profile</h2>
        <button type="button" className="ghost-btn" onClick={onBack}>
          BACK
        </button>
      </div>

      {error && <div className="db-error">Database problem: {error}</div>}
      {busy && <div className="calc">A crimp is running - the profile can be changed when it has finished.</div>}

      <ul className="profiles" role="radiogroup" aria-label="Profile">
        {profiles.map((p) => {
          const active = p.id === activeProfileId;
          return (
            <li key={p.id}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy && !active}
                className={`profile${active ? ' is-active' : ''}`}
                onClick={() => onSelect(p.id)}
              >
                <span className="profile__avatar" aria-hidden="true">
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="profile__body">
                  <b>{p.name}</b>
                  <span>
                    {p.recipeCount} {p.recipeCount === 1 ? 'recipe' : 'recipes'} - {p.cycleCount}{' '}
                    {p.cycleCount === 1 ? 'cycle' : 'cycles'} recorded
                  </span>
                </span>
                {active ? <em className="recipe__tag">ACTIVE</em> : <em className="recipe__tag recipe__tag--soft">TAP TO SWITCH</em>}
              </button>
            </li>
          );
        })}
      </ul>

      <form
        className="new-profile"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field-label" htmlFor="new-profile-name">
          New profile
        </label>
        <div className="new-profile__row">
          <input
            id="new-profile-name"
            className="text-input"
            type="text"
            value={name}
            maxLength={MAX_PROFILE_NAME_LENGTH}
            placeholder="Profile name (e.g. Night shift)"
            onChange={(e) => {
              setName(e.target.value);
              setFormError(null);
            }}
          />
          <button type="submit" className="btn btn--start new-profile__btn" disabled={creating || name.trim() === ''}>
            CREATE
          </button>
        </div>
        {formError ? (
          <div className="calc calc--bad">{formError}</div>
        ) : (
          <div className="new-profile__note">
            {busy
              ? 'The new profile will be created, but not selected until the crimp has finished.'
              : 'The new profile is selected as soon as it is created. It starts with no recipes.'}
          </div>
        )}
      </form>

      <div className="about">
        <div>
          <span>Mode</span>
          <b>{info ? (info.simulation ? 'Simulation' : 'Hardware') : '--'}</b>
        </div>
        <div>
          <span>Sample rate</span>
          <b>{info ? `${info.sampleRateHz} Hz` : '--'}</b>
        </div>
        <div>
          <span>Profiles</span>
          <b>{profiles.length}</b>
        </div>
      </div>

      <div className={`db-info${info && !info.database.ok ? ' is-bad' : ''}`}>
        <span>Database (SQLite)</span>
        {info ? (
          info.database.ok ? (
            <b title={info.database.path}>{info.database.path}</b>
          ) : (
            <b>Not available: {info.database.error}</b>
          )
        ) : (
          <b>--</b>
        )}
      </div>
    </div>
  );
}
