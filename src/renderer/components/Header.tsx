import type { AppInfo, SensorStatus } from '../../shared/types';
import type { Theme } from '../hooks/useTheme';

interface Props {
  info: AppInfo | null;
  sensors: SensorStatus | null;
  profileName: string;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Header({ info, sensors, profileName, theme, onToggleTheme }: Props) {
  const ok = sensors?.health === 'OK';
  const sensorText = !sensors
    ? 'Sensors: --'
    : ok
      ? `Sensors OK - ${sensors.measuredRateHz} Hz`
      : sensors.health === 'STARTING'
        ? 'Sensors starting...'
        : `Sensors FAULT${sensors.message ? `: ${sensors.message}` : ''}`;

  return (
    <header className="header">
      <h1>CRIMPING MACHINE</h1>
      <div className="header__right">
        <span className="profile-pill" title="Active profile">
          {profileName}
        </span>
        <span className={`sensor-pill${ok ? ' is-ok' : sensors ? ' is-bad' : ''}`} title={sensorText}>
          <i className="dot" /> {sensorText}
        </span>
        {info && (
          <span className={`mode-pill${info.simulation ? ' is-sim' : ' is-hw'}`}>
            {info.simulation ? 'SIMULATION' : 'HARDWARE'}
          </span>
        )}
        <button
          type="button"
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 3a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Zm0 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM4.22 4.22a1 1 0 0 1 1.41 0l.71.7a1 1 0 0 1-1.42 1.42l-.7-.71a1 1 0 0 1 0-1.41Zm14.14 14.14a1 1 0 0 1 1.41 0l.71.71a1 1 0 0 1-1.42 1.41l-.7-.7a1 1 0 0 1 0-1.42ZM3 12a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm16 0a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2h-1a1 1 0 0 1-1-1ZM4.22 19.78a1 1 0 0 1 0-1.41l.71-.71a1 1 0 1 1 1.41 1.42l-.7.7a1 1 0 0 1-1.42 0Zm14.14-14.14a1 1 0 0 1 0-1.41l.71-.71a1 1 0 0 1 1.41 1.41l-.7.71a1 1 0 0 1-1.42 0ZM12 19a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Z"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                fill="currentColor"
                d="M20.7 14.9A8.5 8.5 0 0 1 9.1 3.3a1 1 0 0 0-1.2-1.3A10.5 10.5 0 1 0 22 16.1a1 1 0 0 0-1.3-1.2Z"
              />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
