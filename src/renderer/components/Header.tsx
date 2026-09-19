import type { AppInfo, SensorStatus } from '../../shared/types';

interface Props {
  info: AppInfo | null;
  sensors: SensorStatus | null;
  profileName: string;
}

export function Header({ info, sensors, profileName }: Props) {
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
      </div>
    </header>
  );
}
