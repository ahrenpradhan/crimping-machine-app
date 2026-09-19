import type { CrimpMode } from '../../shared/types';
import type { Screen } from '../screens/HomeScreen';

interface Props {
  screen: Screen;
  /** The crimp mode currently selected (what START will run). */
  mode: CrimpMode;
  /** The mode of the cycle that is running right now, if any. */
  runningMode: CrimpMode | null;
  recipeCount: number;
  profileName: string;
  onHome: () => void;
  onCrimp: (mode: CrimpMode) => void;
  onRecipes: () => void;
  onGuide: () => void;
  onProfile: () => void;
}

interface Item {
  key: string;
  title: string;
  hint: string;
  active: boolean;
  running?: boolean;
  onClick: () => void;
}

/**
 * The bottom navigation bar, on every screen: the same destinations as the
 * home screen, plus HOME itself. One tap switches instantly - never disabled
 * or confirmed. A running cycle keeps running when you leave the crimp screen
 * (the tab of its mode is tagged RUNNING).
 */
export function BottomNav(p: Props) {
  const items: Item[] = [
    { key: 'home', title: 'HOME', hint: 'main menu', active: p.screen === 'HOME', onClick: p.onHome },
    {
      key: 'pressure',
      title: 'PRESSURE',
      hint: 'crimp by pressure (bar)',
      active: p.screen === 'CRIMP' && p.mode === 'PRESSURE',
      running: p.runningMode === 'PRESSURE',
      onClick: () => p.onCrimp('PRESSURE'),
    },
    {
      key: 'linear',
      title: 'LINEAR',
      hint: 'crimp by linear (mm)',
      active: p.screen === 'CRIMP' && p.mode === 'LINEAR',
      running: p.runningMode === 'LINEAR',
      onClick: () => p.onCrimp('LINEAR'),
    },
    { key: 'recipes', title: 'RECIPES', hint: `${p.recipeCount} saved`, active: p.screen === 'RECIPES', onClick: p.onRecipes },
    { key: 'guide', title: 'GUIDE / FAQ', hint: 'how to use', active: p.screen === 'GUIDE', onClick: p.onGuide },
    { key: 'profile', title: 'PROFILE', hint: p.profileName, active: p.screen === 'PROFILE', onClick: p.onProfile },
  ];

  return (
    <nav className="mode-nav" aria-label="Main navigation">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-current={item.active ? 'page' : undefined}
          className={`mode-nav__btn${item.active ? ' is-active' : ''}`}
          onClick={item.onClick}
        >
          <span className="mode-nav__title">
            {item.title}
            {item.running && <em className="mode-nav__running">RUNNING</em>}
          </span>
          <span className="mode-nav__hint">{item.hint}</span>
        </button>
      ))}
    </nav>
  );
}
