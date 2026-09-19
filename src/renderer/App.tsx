import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_GEOMETRY,
  DEFAULT_LINEAR_PARAMS,
  coerceLinearParams,
  diameterFromDisplacement,
} from '../shared/linear';
import {
  DEFAULT_PRESSURE_PARAMS,
  coercePressureParams,
  samePressureParams,
} from '../shared/pressure';
import {
  DEFAULT_PROFILE,
  asProfileId,
  recipeBlocker,
  type Recipe,
} from '../shared/recipe';
import type { CrimpMode, LinearCrimpParams, PressureCrimpParams } from '../shared/types';
import { ChartsPanel, type ChartSource } from './components/ChartsPanel';
import type { DieSetup } from './components/DieSetupFields';
import { ControlButtons } from './components/ControlButtons';
import { Counters } from './components/Counters';
import { Header } from './components/Header';
import { SaveRecipeDialog } from './components/SaveRecipeDialog';
import { LinearParamsPanel } from './components/LinearParamsPanel';
import { BottomNav } from './components/BottomNav';
import { PressureParamsPanel } from './components/PressureParamsPanel';
import { Readouts } from './components/Readouts';
import { StatusPanel } from './components/StatusPanel';
import { GuideScreen } from './screens/GuideScreen';
import { HomeScreen, type Screen } from './screens/HomeScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { RecipesScreen } from './screens/RecipesScreen';
import { useMachine } from './hooks/useMachine';
import { useCompact } from './hooks/useCompact';
import { useProfiles } from './hooks/useProfiles';
import { useRecipes } from './hooks/useRecipes';
import { usePersistentState } from './hooks/usePersistentState';
import { isBusyStatus } from './utils/status';

const asRecipeId = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asMode = (v: unknown): CrimpMode | null => (v === 'LINEAR' || v === 'PRESSURE' ? v : null);

/**
 * Intentionally minimal UI: it only issues commands (window.machine.*) and
 * displays the machine state. All machine logic lives in the main process.
 */
export default function App() {
  const machine = useMachine();

  // Operator settings are remembered across restarts (no database in v1).
  const [mode, setMode] = usePersistentState<CrimpMode>('crimp.mode', 'LINEAR', asMode);
  const [linear, setLinear] = usePersistentState<LinearCrimpParams>(
    'crimp.linearParams.v2',
    DEFAULT_LINEAR_PARAMS,
    coerceLinearParams,
  );
  const [pressure, setPressure] = usePersistentState<PressureCrimpParams>(
    'crimp.pressureParams.v2',
    DEFAULT_PRESSURE_PARAMS,
    coercePressureParams,
  );

  // The die is the same physical die in both modes: die size / open diameter
  // are edited from either panel and kept identical in both parameter sets.
  const updateDie = (patch: Partial<DieSetup>): void => {
    setLinear((p) => ({ ...p, ...patch }));
    setPressure((p) => ({ ...p, ...patch }));
  };

  // Profiles live in SQLite; which one is active is remembered between runs.
  const [profileId, setProfileId] = usePersistentState<string>(
    'crimp.profileId',
    DEFAULT_PROFILE.id,
    asProfileId,
  );
  const profilesDb = useProfiles();
  const profile: { id: string; name: string } =
    profilesDb.profiles.find((p) => p.id === profileId) ??
    (profilesDb.loaded
      ? (profilesDb.profiles[0] ?? DEFAULT_PROFILE)
      : { id: profileId, name: '...' });
  // The stored profile no longer exists (e.g. a different database): fall back to the first one.
  useEffect(() => {
    if (profilesDb.loaded && profile.id !== profileId) setProfileId(profile.id);
  }, [profilesDb.loaded, profile.id, profileId, setProfileId]);
  // Recipes and their cycle statistics live in SQLite (main process).
  const recipesDb = useRecipes(profile.id);
  const [activeRecipeId, setActiveRecipeId] = usePersistentState<string | null>(
    'crimp.activeRecipeId',
    null,
    asRecipeId,
  );

  const [screen, setScreen] = useState<Screen>('HOME');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  // Small screens (7"): parameters and graphs share the middle of the crimp screen on two tabs.
  const compact = useCompact();
  const [crimpTab, setCrimpTab] = useState<'PARAMS' | 'GRAPHS'>('PARAMS');
  const [savedRecipe, setSavedRecipe] = useState<{ cycleId: number; name: string } | null>(null);

  const [commandError, setCommandError] = useState<string | null>(null);
  const [chartSource, setChartSource] = useState<ChartSource>('cycle');
  // ON (default): every new cycle brings the graphs back to the cycle view. OFF: they stay as left.
  const [chartAutoCycle, setChartAutoCycle] = usePersistentState<boolean>(
    'crimp.chartAutoCycle',
    true,
    (v) => (typeof v === 'boolean' ? v : null),
  );

  const status = machine.state?.status ?? 'IDLE';
  const busy = isBusyStatus(status);
  const sensorsOk = machine.sensorStatus?.health === 'OK';
  const canStart = !busy && status !== 'FAULT' && sensorsOk;
  const canTeach = !busy && status !== 'FAULT' && sensorsOk;
  const geometry = machine.info?.geometry ?? DEFAULT_GEOMETRY;

  // A new cycle brings the graphs back to the cycle view - only while the auto-switch is on.
  // (Only a cycle change counts: flipping the switch on does not move the graphs by itself.)
  const seenCycleId = useRef(machine.cycleId);
  useEffect(() => {
    if (machine.cycleId === seenCycleId.current) return;
    seenCycleId.current = machine.cycleId;
    if (chartAutoCycle && machine.cycleId > 0) setChartSource('cycle');
  }, [machine.cycleId, chartAutoCycle]);

  // The history is written just after a cycle ends: refresh the per-recipe numbers shortly after,
  // and whenever the recipe list is opened.
  const cycleResult = machine.state?.cycle?.result;
  const reloadRecipes = recipesDb.reload;
  useEffect(() => {
    if (!cycleResult || cycleResult === 'RUNNING') return;
    const timer = setTimeout(() => void reloadRecipes(), 500);
    return () => clearTimeout(timer);
  }, [cycleResult, machine.cycleId, reloadRecipes]);
  useEffect(() => {
    if (screen === 'RECIPES') void reloadRecipes();
  }, [screen, reloadRecipes]);
  const reloadProfiles = profilesDb.reload;
  useEffect(() => {
    if (screen === 'PROFILE') void reloadProfiles();
  }, [screen, reloadProfiles]);

  // The selected mode is free to change at any moment (bottom nav). The only
  // sync: if the window is opened/reloaded while a cycle is already running,
  // start on that cycle's mode once.
  const runningMode = busy ? (machine.state?.mode ?? null) : null;
  const modeSynced = useRef(false);
  useEffect(() => {
    if (modeSynced.current || !machine.state) return;
    modeSynced.current = true;
    if (isBusyStatus(machine.state.status) && machine.state.mode) setMode(machine.state.mode);
  }, [machine.state, setMode]);

  // Only the parameters of the mode that is actually running are locked.
  const locked = busy && runningMode === mode;

  const diameterMm =
    machine.sample !== null
      ? diameterFromDisplacement(linear.openDiameterMm, machine.sample.displacementMm, geometry)
      : null;

  // ---- Profiles / recipes --------------------------------------------------
  const profileRecipes = recipesDb.recipes;
  const activeRecipe = profileRecipes.find((r) => r.id === activeRecipeId) ?? null;
  const recipeModified = activeRecipe !== null && !samePressureParams(activeRecipe.pressure, pressure);

  const lastCycle = machine.state?.cycle ?? null;
  const canSaveRecipe = mode === 'LINEAR' && recipeBlocker(lastCycle) === null;
  const justSaved = savedRecipe !== null && savedRecipe.cycleId === lastCycle?.cycleId;

  const useRecipe = (recipe: Recipe): void => {
    setPressure(recipe.pressure);
    // the die is shared with the linear mode
    setLinear((p) => ({
      ...p,
      dieSizeMm: recipe.pressure.dieSizeMm,
      openDiameterMm: recipe.pressure.openDiameterMm,
    }));
    setActiveRecipeId(recipe.id);
    setMode('PRESSURE');
    setScreen('CRIMP');
  };

  const deleteRecipe = (recipe: Recipe): void => {
    if (recipe.id === activeRecipeId) setActiveRecipeId(null);
    void recipesDb.remove(recipe.id);
  };

  const saveRecipe = (recipe: Recipe): void => {
    setSaveDialogOpen(false);
    void recipesDb.save(recipe).then((ok) => {
      if (ok) setSavedRecipe({ cycleId: recipe.origin?.cycleId ?? 0, name: recipe.name });
      else setCommandError('Recipe could not be saved (database error)');
    });
  };

  /** Switching profile: recipes are per profile, so the loaded recipe is dropped. */
  const switchProfile = (id: string): void => {
    if (id === profile.id) return;
    setProfileId(id);
    setActiveRecipeId(null);
    setSavedRecipe(null);
  };

  /** Returns an error text, or null when the profile was created (and selected, unless a cycle is running). */
  const createProfile = async (name: string): Promise<string | null> => {
    const res = await profilesDb.create(name);
    if (!res.ok) return res.error;
    if (!busy) switchProfile(res.profile.id);
    return null;
  };

  const openCrimp = (next: CrimpMode): void => {
    setMode(next);
    setScreen('CRIMP');
  };

  const handleStart = async (): Promise<void> => {
    setCommandError(null);
    // The cycle is filed in the history under this profile - and, in pressure mode, under the loaded recipe.
    const context = {
      profileId: profile.id,
      recipeId: mode === 'PRESSURE' ? (activeRecipe?.id ?? null) : null,
    };
    const result =
      mode === 'LINEAR'
        ? await window.machine.startLinearCrimp(linear, context)
        : await window.machine.startPressureCrimp(pressure, context);
    if (!result.ok) setCommandError(result.error ?? 'Start was rejected');
  };

  const handleStop = async (): Promise<void> => {
    setCommandError(null);
    await window.machine.stopCrimp();
  };

  const handleTeach = async (): Promise<void> => {
    setCommandError(null);
    const result = await window.machine.teachOpenPosition();
    if (!result.ok) setCommandError(result.error ?? 'Teach was rejected');
  };

  const recipeChip =
    mode === 'PRESSURE' && activeRecipe ? (
      <div className={`recipe-chip${recipeModified ? ' is-modified' : ''}`}>
        <span>
          Recipe: <b>{activeRecipe.name}</b>
        </span>
        {recipeModified ? (
          <button type="button" onClick={() => useRecipe(activeRecipe)} disabled={busy}>
            RESTORE
          </button>
        ) : (
          <em>loaded</em>
        )}
      </div>
    ) : null;

  const crimpScreen = (
    <main className={`crimp${compact ? ' crimp--compact' : ''}`}>
      <div className="crimp__left">
        <section className="strip">
          <Readouts sample={machine.sample} diameterMm={diameterMm} />
          <Counters
            counters={machine.state?.counters ?? { good: 0, bad: 0, total: 0 }}
            onAddRejected={() => void window.machine.addRejected()}
            onReset={() => void window.machine.resetCounters()}
          />
        </section>

        {compact ? (
          <div className="crimp__tabs">
            <div className="charts__toggle" role="tablist" aria-label="Crimp screen">
              <button
                type="button"
                role="tab"
                aria-selected={crimpTab === 'PARAMS'}
                className={crimpTab === 'PARAMS' ? 'is-active' : ''}
                onClick={() => setCrimpTab('PARAMS')}
              >
                PARAMETERS
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={crimpTab === 'GRAPHS'}
                className={crimpTab === 'GRAPHS' ? 'is-active' : ''}
                onClick={() => setCrimpTab('GRAPHS')}
              >
                GRAPHS
              </button>
            </div>
            {recipeChip}
          </div>
        ) : (
          recipeChip
        )}

        {(!compact || crimpTab === 'PARAMS') && (
        <div className="crimp__params">
          {mode === 'LINEAR' ? (
            <LinearParamsPanel
              params={linear}
              onChange={(next) => {
                setLinear(next);
                // keep the shared die setup identical in the pressure parameters
                setPressure((p) => ({
                  ...p,
                  dieSizeMm: next.dieSizeMm,
                  openDiameterMm: next.openDiameterMm,
                }));
              }}
              geometry={geometry}
              locked={locked}
              canTeach={canTeach}
              onTeach={() => void handleTeach()}
              zeroOffsetMm={machine.sensorStatus?.zeroOffsetMm ?? null}
            />
          ) : (
            <PressureParamsPanel
              params={pressure}
              onChange={setPressure}
              onDieChange={updateDie}
              maxTargetBar={machine.info?.limits.maxTargetPressureBar ?? 400}
              locked={locked}
              canTeach={canTeach}
              onTeach={() => void handleTeach()}
              zeroOffsetMm={machine.sensorStatus?.zeroOffsetMm ?? null}
            />
          )}
        </div>
        )}

        {compact && crimpTab === 'GRAPHS' && (
          <div className="crimp__graphs">
            <ChartsPanel
              view={machine}
              source={chartSource}
              onSourceChange={setChartSource}
              autoCycle={chartAutoCycle}
              onAutoCycleChange={setChartAutoCycle}
              layout="row"
            />
          </div>
        )}

        <div className="crimp__bottom">
          <div className="crimp__status">
            <StatusPanel state={machine.state} commandError={commandError} />
            {canSaveRecipe && (
              <button
                type="button"
                className="save-recipe"
                disabled={busy}
                onClick={() => setSaveDialogOpen(true)}
              >
                {justSaved ? `SAVED AS "${savedRecipe?.name}" - SAVE ANOTHER` : 'SAVE AS RECIPE'}
              </button>
            )}
          </div>
          <ControlButtons
            canStart={canStart}
            fault={status === 'FAULT'}
            onStart={() => void handleStart()}
            onStop={() => void handleStop()}
          />
        </div>
        <p className="disclaimer">
          Prototype only - not a safety system. Emergency stop must be hard-wired.
        </p>
      </div>

      {!compact && (
        <ChartsPanel
          view={machine}
          source={chartSource}
          onSourceChange={setChartSource}
          autoCycle={chartAutoCycle}
          onAutoCycleChange={setChartAutoCycle}
        />
      )}
    </main>
  );

  const goHome = (): void => setScreen('HOME');

  return (
    <div className="app">
      <Header
        info={machine.info}
        sensors={machine.sensorStatus}
        profileName={profile.name}
      />

      {screen === 'HOME' && (
        <HomeScreen
          state={machine.state}
          profileName={profile.name}
          activeRecipeName={activeRecipe?.name ?? null}
          recipeCount={profileRecipes.length}
          onPressure={() => openCrimp('PRESSURE')}
          onLinear={() => openCrimp('LINEAR')}
          onRecipes={() => setScreen('RECIPES')}
          onGuide={() => setScreen('GUIDE')}
          onProfile={() => setScreen('PROFILE')}
        />
      )}
      {screen === 'CRIMP' && crimpScreen}
      {screen === 'RECIPES' && (
        <RecipesScreen
          recipes={profileRecipes}
          stats={recipesDb.stats}
          error={recipesDb.error}
          activeRecipeId={activeRecipeId}
          busy={busy}
          onUse={useRecipe}
          onDelete={deleteRecipe}
          onBack={goHome}
        />
      )}
      {screen === 'GUIDE' && <GuideScreen onBack={goHome} />}
      {screen === 'PROFILE' && (
        <ProfileScreen
          profiles={profilesDb.profiles}
          activeProfileId={profile.id}
          busy={busy}
          error={profilesDb.error}
          info={machine.info}
          onSelect={switchProfile}
          onCreate={createProfile}
          onBack={goHome}
        />
      )}

      {/* The home screen is the menu itself, so the bar is only shown on the other screens. */}
      {screen !== 'HOME' && (
        <BottomNav
          screen={screen}
          mode={mode}
          runningMode={runningMode}
          recipeCount={profileRecipes.length}
          profileName={profile.name}
          onHome={goHome}
          onCrimp={openCrimp}
          onRecipes={() => setScreen('RECIPES')}
          onGuide={() => setScreen('GUIDE')}
          onProfile={() => setScreen('PROFILE')}
        />
      )}

      {saveDialogOpen && lastCycle && (
        <SaveRecipeDialog
          cycle={lastCycle}
          profileId={profile.id}
          onSave={saveRecipe}
          onCancel={() => setSaveDialogOpen(false)}
        />
      )}
    </div>
  );
}
