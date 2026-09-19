import type { MachineState } from '../../shared/types';
import { STATUS_LABEL, statusTone } from '../utils/status';

export type Screen = 'HOME' | 'CRIMP' | 'RECIPES' | 'GUIDE' | 'PROFILE';

interface Props {
  state: MachineState | null;
  profileName: string;
  activeRecipeName: string | null;
  recipeCount: number;
  onPressure: () => void;
  onLinear: () => void;
  onRecipes: () => void;
  onGuide: () => void;
  onProfile: () => void;
}

interface Tile {
  key: string;
  icon: string;
  title: string;
  hint: string;
  onClick: () => void;
}

/** Home screen: one big touch tile per function (like the Uniflex menu). */
export function HomeScreen(p: Props) {
  const status = p.state?.status ?? 'IDLE';
  const tiles: Tile[] = [
    { key: 'pressure', icon: 'P', title: 'CRIMP BY PRESSURE', hint: p.activeRecipeName ? `Recipe: ${p.activeRecipeName}` : 'Production - stops at target pressure', onClick: p.onPressure },
    { key: 'linear', icon: 'Ø', title: 'CRIMP BY LINEAR', hint: 'Set-up - stops at target diameter', onClick: p.onLinear },
    { key: 'recipes', icon: 'R', title: 'RECIPES', hint: `${p.recipeCount} saved`, onClick: p.onRecipes },
    { key: 'guide', icon: '?', title: 'GUIDE / FAQ', hint: 'How to use the machine', onClick: p.onGuide },
    { key: 'profile', icon: 'U', title: 'PROFILE', hint: p.profileName, onClick: p.onProfile },
  ];

  return (
    <div className="screen screen--home">
      <div className="home__status">
        <span className={`badge badge--${statusTone(status)}`}>{STATUS_LABEL[status]}</span>
        <span className="home__profile">Profile: {p.profileName}</span>
      </div>
      <div className="home__grid">
        {tiles.map((t) => (
          <button key={t.key} type="button" className="tile" onClick={t.onClick}>
            <span className="tile__icon" aria-hidden="true">
              {t.icon}
            </span>
            <span className="tile__title">{t.title}</span>
            <span className="tile__hint">{t.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
