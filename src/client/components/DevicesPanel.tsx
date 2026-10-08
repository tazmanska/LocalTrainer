import { useEffect, useState } from 'react';
import { bluetoothUnavailable, type BleSource } from '../devices/ble';
import type { DeviceInfo } from '../devices/source';

export type DeviceMode = 'sim' | 'ble';

const MODE_KEY = 'trenazer:mode';

export function loadMode(): DeviceMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'ble' ? 'ble' : 'sim';
  } catch {
    return 'sim';
  }
}

export function storeMode(m: DeviceMode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    // tryb wróci do symulacji po odświeżeniu
  }
}

/** Przerysowuje komponent przy każdej zmianie stanu urządzeń BLE. */
export function useDeviceChanges(ble: BleSource) {
  const [, setN] = useState(0);
  useEffect(() => ble.onChange(() => setN((n) => n + 1)), [ble]);
}

const STATE_TEXT: Record<DeviceInfo['state'], string> = {
  idle: 'Nie połączono',
  connecting: 'Łączenie…',
  connected: 'Połączono',
  reconnecting: 'Ponowne łączenie…',
  error: 'Błąd',
};

interface Props {
  mode: DeviceMode;
  onMode: (m: DeviceMode) => void;
  ble: BleSource;
}

export function DevicesPanel({ mode, onMode, ble }: Props) {
  useDeviceChanges(ble);
  const unavailable = bluetoothUnavailable();
  const [trainer, hr, pedals] = ble.allDevices() as [DeviceInfo, DeviceInfo, DeviceInfo];
  const rows: { info: DeviceInfo; sub: string; pair: () => void; drop: () => void }[] = [
    {
      info: trainer,
      sub: ble.trainer.protocol === 'fec' ? 'Trenażer · Tacx FE-C · sterowanie ERG' : 'Trenażer · FTMS · sterowanie ERG',
      pair: () => void ble.trainer.pair(),
      drop: () => ble.trainer.disconnect(),
    },
    { info: hr, sub: 'Pas tętna · Heart Rate Service', pair: () => void ble.heartRate.pair(), drop: () => ble.heartRate.disconnect() },
    {
      info: pedals,
      sub: 'Pedały mocy · Cycling Power · moc L/P i balans',
      pair: () => void ble.pedals.pair(),
      drop: () => ble.pedals.disconnect(),
    },
  ];

  return (
    <div className="devpanel">
      <div className="devhead">
        <span className="lbl">Urządzenia</span>
        <div className="seg" role="radiogroup" aria-label="Źródło danych">
          <button type="button" role="radio" aria-checked={mode === 'sim'} onClick={() => onMode('sim')}>
            Symulacja
          </button>
          <button type="button" role="radio" aria-checked={mode === 'ble'} onClick={() => onMode('ble')}>
            Bluetooth
          </button>
        </div>
      </div>
      {mode === 'sim' ? (
        <p className="muted small">Trenażer i pulsometr są symulowane: moc podąża za celem, tętno rośnie z opóźnieniem.</p>
      ) : unavailable ? (
        <p className="err small">
          {unavailable}
          {!window.isSecureContext && (
            <>
              {' '}
              <a href="/api/cert" download>
                Pobierz certyfikat
              </a>{' '}
              i dodaj go do zaufanych (instrukcja w zakładce Profil).
            </>
          )}
        </p>
      ) : (
        <div className="devices">
          {rows.map(({ info, sub, pair, drop }) => (
            <div className="dev" key={info.kind}>
              <span className={info.connected ? 'dot' : info.state === 'connecting' || info.state === 'reconnecting' ? 'dot warn' : 'dot off'} />
              <div className="t">
                {info.label}
                <small>{sub}</small>
                {info.message && <small className={info.state === 'error' ? 'err' : undefined}>{info.message}</small>}
              </div>
              <span className="chip">{STATE_TEXT[info.state]}</span>
              {info.connected || info.state === 'reconnecting' ? (
                <button className="btn" type="button" onClick={drop}>
                  Rozłącz
                </button>
              ) : (
                <button className="btn primary" type="button" onClick={pair} disabled={info.state === 'connecting'}>
                  {info.kind === 'trainer' ? 'Połącz trenażer' : info.kind === 'hr' ? 'Połącz pas' : 'Połącz pedały'}
                </button>
              )}
            </div>
          ))}
          {pedals.connected && (
            <div className="devhead">
              <span className="small muted">Moc, strefy i zapis sesji z:</span>
              <div className="seg" role="radiogroup" aria-label="Źródło mocy">
                <button type="button" role="radio" aria-checked={ble.powerSource === 'pedals'} onClick={() => (ble.powerSource = 'pedals')}>
                  Pedałów
                </button>
                <button type="button" role="radio" aria-checked={ble.powerSource === 'trainer'} onClick={() => (ble.powerSource = 'trainer')}>
                  Trenażera
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
