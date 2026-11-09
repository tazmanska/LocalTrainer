import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PROFILE, HR_ZONES, zoneIndex, type Profile } from '../../shared/profile';
import {
  intervalStarts,
  paceText,
  repeatBlock,
  TREADMILL_MAX_KPH,
  TREADMILL_MIN_KPH,
  treadmillStats,
  validateTreadmillWorkout,
  type TreadmillInterval,
  type TreadmillWorkout,
} from '../../shared/treadmill';
import { deleteTreadmillWorkout, getProfile, listTreadmillWorkouts, saveSession, saveTreadmillWorkout } from '../api';
import { useDeviceChanges } from '../components/DevicesPanel';
import { DurationInput, Stepper } from '../components/DurationInput';
import { useFullscreen } from '../components/fullscreen';
import { ReconnectSaved } from '../components/ReconnectSaved';
import { Sparkline } from '../components/Sparkline';
import { Stat } from '../components/Stat';
import { bluetoothUnavailable, type BleSource } from '../devices/ble';
import type { TreadmillData } from '../devices/protocol';
import type { DeviceInfo } from '../devices/source';
import { changeOf, fmtMinutes, fmtTime, pl } from '../format';
import { TreadmillRunner } from '../session/treadmill';
import { countdownBeep, loadMuted, segmentStartBeep, storeMuted, unlockAudio } from '../sound';

interface Props {
  ble: BleSource;
  /** zmiana stanu „trening na bieżni w toku” (kropka na zakładce) */
  onActive: (active: boolean) => void;
  /** bieg zapisany w historii */
  onSaved: (sessionId: string) => void;
}

/** Kolor prędkości: marsz, trucht, bieg spokojny, tempo, szybko. */
export function speedColor(kph: number): string {
  return kph < 6 ? 'var(--z1)' : kph < 8 ? 'var(--z2)' : kph < 10 ? 'var(--z3)' : kph < 11 ? 'var(--z4)' : 'var(--z5)';
}

const kmh = (n: number) => `${pl(n, 1)} km/h`;

export function TreadmillScreen({ ble, onActive, onSaved }: Props) {
  const [workouts, setWorkouts] = useState<TreadmillWorkout[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<TreadmillWorkout | 'new' | null>(null);
  const [active, setActive] = useState<{ workout: TreadmillWorkout; key: number } | null>(null);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listTreadmillWorkouts()
      .then((ws) => {
        setWorkouts(ws);
        setSelected(ws[0]?.id ?? null);
      })
      .catch((e: Error) => setError(e.message));
    getProfile()
      .then(setProfile)
      .catch(() => {});
    // Wejście na zakładkę łączy się z zapamiętaną bieżnią i pasem tętna bez okna wyboru.
    void ble.treadmill.reconnectSaved();
    void ble.heartRate.reconnectSaved();
  }, [ble]);

  useEffect(() => onActive(active !== null), [active, onActive]);

  if (active) {
    return (
      <TreadmillRun
        key={active.key}
        workout={active.workout}
        ble={ble}
        profile={profile}
        onClose={() => setActive(null)}
        onSaved={(id) => {
          setActive(null);
          onSaved(id);
        }}
      />
    );
  }

  if (editing) {
    return (
      <TreadmillEditor
        initial={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={(w) => {
          setWorkouts((ws) => [w, ...(ws ?? []).filter((x) => x.id !== w.id)]);
          setSelected(w.id);
          setEditing(null);
        }}
      />
    );
  }

  const current = workouts?.find((w) => w.id === selected) ?? null;

  async function remove(w: TreadmillWorkout) {
    try {
      await deleteTreadmillWorkout(w.id);
      const ws = (workouts ?? []).filter((x) => x.id !== w.id);
      setWorkouts(ws);
      setSelected(ws[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="two">
      <div>
        <div className="panel devwrap">
          <TreadmillDevices ble={ble} />
        </div>
        <div className="tm-listhead">
          <span className="lbl">Treningi na bieżnię</span>
          <button className="btn primary" type="button" onClick={() => setEditing('new')}>
            Nowy trening
          </button>
        </div>
        {error && <p className="err">{error}</p>}
        <div className="list" role="listbox" aria-label="Treningi na bieżnię">
          {workouts === null && !error && <p className="muted">Wczytywanie…</p>}
          {workouts?.length === 0 && <p className="muted">Brak treningów. Kliknij „Nowy trening”, żeby ułożyć pierwsze interwały.</p>}
          {workouts?.map((w) => {
            const s = treadmillStats(w.intervals);
            return (
              <button key={w.id} type="button" className="wcard" role="option" aria-selected={w.id === selected} onClick={() => setSelected(w.id)}>
                <div>
                  <div className="wname">{w.name}</div>
                  <div className="meta">
                    {fmtMinutes(s.duration)} · {pl(s.distanceKm, 1)} km · maks. {kmh(s.maxSpeed)}
                  </div>
                </div>
                <TreadmillChart intervals={w.intervals} mini />
              </button>
            );
          })}
        </div>
      </div>
      {current ? (
        <TreadmillDetail
          key={current.id}
          w={current}
          onStart={() => setActive({ workout: current, key: Date.now() })}
          onEdit={() => setEditing(current)}
          onDelete={() => void remove(current)}
        />
      ) : (
        <div className="panel detail placeholder">Wybierz trening z listy albo ułóż nowy.</div>
      )}
    </div>
  );
}

const STATE_TEXT: Record<DeviceInfo['state'], string> = {
  idle: 'Nie połączono',
  connecting: 'Łączenie…',
  connected: 'Połączono',
  reconnecting: 'Ponowne łączenie…',
  error: 'Błąd',
};

function TreadmillDevices({ ble }: { ble: BleSource }) {
  useDeviceChanges(ble);
  const unavailable = bluetoothUnavailable();
  const tm = ble.treadmill;
  const hr = ble.heartRate;
  const range = tm.speedRange;
  const rows = [
    {
      key: 'tm',
      label: tm.label || 'Bieżnia',
      sub:
        'Bieżnia · FTMS · prędkość' +
        (tm.supportsIncline ? ' i nachylenie' : '') +
        (range ? ` · ${pl(range.min, 1)}–${pl(tm.maxSpeed, 1)} km/h` : ` · do ${TREADMILL_MAX_KPH} km/h`),
      dev: tm,
      connect: 'Połącz bieżnię',
    },
    { key: 'hr', label: hr.label || 'Pas tętna', sub: 'Pas tętna · bez pasa tętno z bieżni, jeśli je podaje', dev: hr, connect: 'Połącz pas' },
  ];
  return (
    <div className="devpanel">
      <div className="devhead">
        <span className="lbl">Urządzenia</span>
      </div>
      {unavailable ? (
        <p className="err small">{unavailable}</p>
      ) : (
        <div className="devices">
          <ReconnectSaved devices={[tm, hr]} />
          {rows.map(({ key, label, sub, dev, connect }) => {
            const connected = dev.state === 'connected';
            return (
              <div className="dev" key={key}>
                <span className={connected ? 'dot' : dev.state === 'connecting' || dev.state === 'reconnecting' ? 'dot warn' : 'dot off'} />
                <div className="t">
                  {label}
                  <small>{sub}</small>
                  {dev.message && <small className={dev.state === 'error' ? 'err' : undefined}>{dev.message}</small>}
                </div>
                <span className="chip">{STATE_TEXT[dev.state]}</span>
                {connected || dev.state === 'reconnecting' ? (
                  <button className="btn" type="button" onClick={() => dev.disconnect()}>
                    Rozłącz
                  </button>
                ) : (
                  <button className="btn primary" type="button" onClick={() => void dev.pair()} disabled={dev.state === 'connecting'}>
                    {connect}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TreadmillDetail({ w, onStart, onEdit, onDelete }: { w: TreadmillWorkout; onStart: () => void; onEdit: () => void; onDelete: () => void }) {
  const s = useMemo(() => treadmillStats(w.intervals), [w]);
  const starts = useMemo(() => intervalStarts(w.intervals), [w]);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="panel detail">
      <div className="hd">
        <h2>{w.name}</h2>
        <div className="actions">
          <button className="btn big primary" type="button" onClick={onStart}>
            Rozpocznij trening
          </button>
          <button className="btn" type="button" onClick={onEdit}>
            Edytuj
          </button>
          {confirm ? (
            <>
              <button className="btn danger" type="button" onClick={onDelete}>
                Usuń na pewno
              </button>
              <button className="btn" type="button" onClick={() => setConfirm(false)}>
                Anuluj
              </button>
            </>
          ) : (
            <button className="btn danger" type="button" onClick={() => setConfirm(true)}>
              Usuń
            </button>
          )}
        </div>
      </div>
      <div className="stats">
        <Stat k="Czas" v={fmtMinutes(s.duration)} />
        <Stat k="Dystans" v={`${pl(s.distanceKm, 2)} km`} />
        <Stat k="Śr. prędkość" v={kmh(s.avgSpeed)} />
        <Stat k="Maks." v={kmh(s.maxSpeed)} />
      </div>
      <TreadmillChart intervals={w.intervals} />
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Odcinek</th>
              <th className="r">Start</th>
              <th className="r">Czas</th>
              <th className="r">Prędkość</th>
              <th className="r">Tempo</th>
            </tr>
          </thead>
          <tbody>
            {w.intervals.map((it, i) => (
              <tr key={i}>
                <td>
                  <span className="sw" style={{ background: speedColor(it.speed) }} />
                  {it.label}
                </td>
                <td className="r">{fmtTime(starts[i]!)}</td>
                <td className="r">{fmtTime(it.duration)}</td>
                <td className="r">{it.hrZone != null ? `${HR_ZONES[it.hrZone]!.id} tętna · start ${kmh(it.speed)}` : kmh(it.speed)}</td>
                <td className="r">{paceText(it.speed)} /km</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- edytor ----------

const TEMPLATE: TreadmillInterval[] = [
  { label: 'Rozgrzewka', duration: 300, speed: 6, incline: null },
  ...repeatBlock(6, { duration: 120, speed: 10, incline: null }, { duration: 60, speed: 6, incline: null }),
  { label: 'Schłodzenie', duration: 300, speed: 5, incline: null },
];

function SpeedInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return <Stepper label={label} value={value} onChange={onChange} step={0.5} min={TREADMILL_MIN_KPH} max={TREADMILL_MAX_KPH} digits={1} unit="km/h" />;
}

function TreadmillEditor({ initial, onCancel, onSaved }: { initial: TreadmillWorkout | null; onCancel: () => void; onSaved: (w: TreadmillWorkout) => void }) {
  const [name, setName] = useState(initial?.name ?? 'Interwały 6×2 min');
  const [intervals, setIntervals] = useState<TreadmillInterval[]>(() => (initial?.intervals ?? TEMPLATE).map((x) => ({ ...x })));
  const [rep, setRep] = useState({ reps: 4, work: 180, workSpeed: 10, rest: 90, restSpeed: 6 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const stats = treadmillStats(intervals);

  const update = (i: number, patch: Partial<TreadmillInterval>) => setIntervals((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) =>
    setIntervals((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const out = [...xs];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });

  async function save() {
    const v = validateTreadmillWorkout({ name, intervals });
    if ('error' in v) return setError(v.error);
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveTreadmillWorkout(v.workout, initial?.id));
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="panel detail tm-editor">
      <div className="hd">
        <h2>{initial ? 'Edycja treningu' : 'Nowy trening na bieżnię'}</h2>
        <div className="actions">
          <button className="btn primary" type="button" onClick={save} disabled={saving}>
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
          <button className="btn" type="button" onClick={onCancel} disabled={saving}>
            Anuluj
          </button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="tm-name">Nazwa</label>
        <div className="in">
          <input id="tm-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      {error && <p className="err">{error}</p>}
      <div className="stats">
        <Stat k="Czas" v={fmtMinutes(stats.duration)} />
        <Stat k="Dystans" v={`${pl(stats.distanceKm, 2)} km`} />
        <Stat k="Odcinki" v={String(intervals.length)} />
      </div>
      <TreadmillChart intervals={intervals} />
      <div className="ed-stages">
        {intervals.map((it, i) => (
          <div className="ed-stage" key={i}>
            <input className="tm-text" value={it.label} maxLength={40} aria-label={`Nazwa odcinka ${i + 1}`} onChange={(e) => update(i, { label: e.target.value })} />
            <DurationInput label={`Czas odcinka ${i + 1}`} value={it.duration} onChange={(duration) => update(i, { duration })} />
            <select
              aria-label={`Cel odcinka ${i + 1}`}
              value={it.hrZone ?? 'speed'}
              onChange={(e) => update(i, { hrZone: e.target.value === 'speed' ? null : Number(e.target.value) })}
            >
              <option value="speed">Stała prędkość</option>
              {HR_ZONES.map((z, zi) => (
                <option key={z.id} value={zi}>
                  Tętno {z.id} {z.name}
                </option>
              ))}
            </select>
            {it.hrZone != null && <span className="muted small">start</span>}
            <SpeedInput label={`Prędkość odcinka ${i + 1}`} value={it.speed} onChange={(speed) => update(i, { speed })} />
            <span className="tm-rowbtns">
              <button type="button" className="btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Przesuń w górę">
                ↑
              </button>
              <button type="button" className="btn" onClick={() => move(i, 1)} disabled={i === intervals.length - 1} aria-label="Przesuń w dół">
                ↓
              </button>
              <button type="button" className="btn danger" onClick={() => setIntervals((xs) => xs.filter((_, j) => j !== i))} aria-label="Usuń odcinek">
                ✕
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className="tm-add">
        <button
          className="btn"
          type="button"
          onClick={() => setIntervals((xs) => [...xs, { label: `Odcinek ${xs.length + 1}`, duration: 120, speed: xs.at(-1)?.speed ?? 6, incline: null }])}
        >
          Dodaj odcinek
        </button>
        <div className="tm-rep">
          <span className="lbl">Powtórzenia</span>
          <Stepper label="Liczba powtórzeń" value={rep.reps} onChange={(reps) => setRep({ ...rep, reps })} step={1} min={1} max={30} unit="×" />
          <span className="ed-pair">
            <span className="muted small">bieg</span>
            <DurationInput label="Czas biegu" value={rep.work} onChange={(work) => setRep({ ...rep, work })} />
            <SpeedInput label="Prędkość biegu" value={rep.workSpeed} onChange={(workSpeed) => setRep({ ...rep, workSpeed })} />
          </span>
          <span className="ed-pair">
            <span className="muted small">przerwa</span>
            <DurationInput label="Czas przerwy" value={rep.rest} onChange={(rest) => setRep({ ...rep, rest })} />
            <SpeedInput label="Prędkość przerwy" value={rep.restSpeed} onChange={(restSpeed) => setRep({ ...rep, restSpeed })} />
          </span>
          <button
            className="btn"
            type="button"
            onClick={() =>
              setIntervals((xs) => [
                ...xs,
                ...repeatBlock(rep.reps, { duration: rep.work, speed: rep.workSpeed, incline: null }, { duration: rep.rest, speed: rep.restSpeed, incline: null }),
              ])
            }
          >
            Dodaj blok
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- wykres ----------

const VW = 1000;
const VH = 200;

/** Odcinki jako słupki o wysokości prędkości; w trakcie treningu z prędkością zmierzoną i znacznikiem „teraz”. */
export function TreadmillChart({ intervals, mini, progress, speeds }: { intervals: readonly TreadmillInterval[]; mini?: boolean; progress?: number; speeds?: (number | null)[] }) {
  const total = intervals.reduce((a, s) => a + s.duration, 0) || 1;
  const starts = intervalStarts(intervals);
  const x = (t: number) => (t / total) * VW;
  const y = (v: number) => VH - (Math.min(v, TREADMILL_MAX_KPH) / TREADMILL_MAX_KPH) * VH * 0.95;
  const step = speeds ? Math.max(1, Math.ceil(speeds.length / 600)) : 1;
  const line: string[] = [];
  if (speeds) {
    for (let i = 0; i < speeds.length; i += step) {
      const v = speeds[i];
      if (v != null) line.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    }
  }
  return (
    <div className={mini ? 'wchart mini' : 'wchart'}>
      <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden="true">
        {intervals.map((it, i) => (
          <rect
            key={i}
            x={x(starts[i]!)}
            y={y(it.speed)}
            width={Math.max(0.5, x(it.duration) - (mini ? 0 : 1))}
            height={VH - y(it.speed)}
            fill={speedColor(it.speed)}
            opacity={progress !== undefined && starts[i]! + it.duration <= progress ? 0.45 : progress !== undefined && starts[i]! > progress ? 0.3 : 0.85}
          />
        ))}
        {line.length > 1 && <polyline points={line.join(' ')} fill="none" stroke="var(--fg)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        {progress !== undefined && <line x1={x(progress)} x2={x(progress)} y1={0} y2={VH} stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

// ---------- trening ----------

/** okno wykresów w tle kafelków, s */
const SPARK_WINDOW = 180;
const BELT_WAIT_S = 15;

/** Prędkość docelowa następnego odcinka; null na ostatnim. */
function nextSpeed(r: TreadmillRunner): number | null {
  return r.index + 1 < r.workout.intervals.length ? r.speedOf(r.index + 1) : null;
}

interface RunProps {
  workout: TreadmillWorkout;
  ble: BleSource;
  profile: Profile;
  onClose: () => void;
  onSaved: (sessionId: string) => void;
}

function TreadmillRun({ workout, ble, profile, onClose, onSaved }: RunProps) {
  const maxHr = profile.maxHr;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useDeviceChanges(ble);
  const tm = ble.treadmill;
  const runner = useRef<TreadmillRunner>();
  runner.current ??= new TreadmillRunner(workout, tm.maxSpeed, profile.maxHr);
  const r = runner.current;
  const data = useRef<TreadmillData>({ speedKph: null, distanceM: null, inclinePct: null, hr: null });
  const hrRef = useRef<number | null>(null);
  const [, setFrame] = useState(0);
  const [ending, setEnding] = useState(false);
  const [muted, setMuted] = useState(loadMuted);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const redraw = () => setFrame((f) => f + 1);
  const connected = tm.state === 'connected';
  const { isFull, toggle: fullscreen, exit: exitFull } = useFullscreen();
  /**
   * Po starcie taśma rusza z opóźnieniem (bieżnia odlicza kilka sekund), więc zegar treningu stoi,
   * dopóki bieżnia nie zgłosi prędkości ustawionej przez aplikację (bieżnia podaje prędkość zadaną, a nie
   * rzeczywistą prędkość taśmy, i zgłasza ją dopiero po odliczaniu); najwyżej BELT_WAIT_S sekund.
   */
  const beltWait = useRef(0);

  /** Wysyła bieżący cel na bieżnię (tylko w trakcie biegu, żeby nie ruszyć taśmy w pauzie). */
  const sendTarget = () => {
    if (r.running) tm.setTarget(r.targetSpeed(), r.targetIncline());
  };

  useEffect(() => {
    const offData = ble.onTreadmill((d) => (data.current = d));
    const offHr = ble.onReading((x) => {
      if (x.hr !== undefined) hrRef.current = x.hr;
    });
    // Zatrzymanie lub pauza przyciskiem na konsoli (albo kluczem bezpieczeństwa) wstrzymuje trening; start z konsoli go wznawia.
    const offMachine = ble.onMachine((e) => {
      if (e === 'started') {
        if (r.startedAt && !r.running && !r.finished) {
          r.start();
          beltWait.current = BELT_WAIT_S;
          sendTarget();
        }
      } else r.pause();
      redraw();
    });
    const timer = setInterval(() => {
      const moving = (data.current.speedKph ?? 0) >= Math.min(r.targetSpeed(), tm.maxSpeed) - 0.15;
      if (r.running && beltWait.current > 0 && !moving && tm.state === 'connected') {
        beltWait.current--;
        sendTarget();
      } else if (r.running) {
        beltWait.current = 0;
        r.tick({ speed: data.current.speedKph, hr: hrRef.current, distanceM: data.current.distanceM });
        if (!mutedRef.current) {
          if (r.finished || r.intervalElapsed === 0) segmentStartBeep();
          else if (r.intervalRemaining >= 1 && r.intervalRemaining <= 5) countdownBeep(changeOf(r.targetSpeed(), nextSpeed(r)));
        }
        if (r.finished) {
          void tm.stop();
          setEnding(true);
        } else sendTarget();
      }
      redraw();
    }, 1000);
    return () => {
      clearInterval(timer);
      offData();
      offHr();
      offMachine();
    };
  }, [r, ble]);

  // Ekran nie gaśnie w trakcie biegu.
  useEffect(() => {
    if (!r.running || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    return () => void lock?.release();
  }, [r.running]);

  const toggle = () => {
    if (r.running) {
      r.pause();
      void tm.pause();
    } else {
      unlockAudio();
      r.start();
      if (connected) beltWait.current = BELT_WAIT_S;
      tm.setTarget(r.targetSpeed(), r.targetIncline());
      void tm.start();
    }
    redraw();
  };
  const skip = () => {
    r.skip();
    if (r.finished) {
      void tm.stop();
      setEnding(true);
    } else sendTarget();
    redraw();
  };
  const adjust = (d: number) => {
    r.adjust(d);
    sendTarget();
    redraw();
  };
  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const s = await saveSession({
        workoutId: workout.id,
        workoutName: workout.name,
        startedAt: (r.startedAt ?? new Date()).toISOString(),
        ftp: profile.ftp,
        maxHr: profile.maxHr,
        weight: profile.weight,
        source: 'ble',
        sport: 'run',
        segments: [],
        intervals: workout.intervals,
        samples: r.toSessionSamples(),
      });
      exitFull();
      void tm.stop();
      onSaved(s.id);
    } catch (e) {
      setSaveError((e as Error).message);
      setSaving(false);
    }
  }

  const finish = () => {
    exitFull();
    r.pause();
    void tm.stop();
    onClose();
  };

  const it = r.interval;
  const next = workout.intervals[r.index + 1];
  const target = r.targetSpeed();
  const speed = data.current.speedKph;
  const hr = hrRef.current ?? 0;
  const hz = zoneIndex(HR_ZONES, maxHr, hr);
  const started = r.startedAt !== null;
  const hrs = r.samples.map((s) => s.hr).filter((h): h is number => !!h);
  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const avgSpeed = r.elapsed ? (r.distance / r.elapsed) * 3.6 : 0;
  const nextS = nextSpeed(r);
  const hrRange = r.hrRange();
  // co robi regulator: podpowiedź pod prędkością w odcinku ze strefą tętna
  const hrHint = !hrRange
    ? ''
    : !hr
      ? 'brak tętna, prędkość stała'
      : r.intervalElapsed < 60
        ? 'czekam, aż tętno się ustabilizuje'
        : hr > hrRange.to - 2
          ? 'zwalniam'
          : hr < hrRange.from + 2
            ? 'przyspieszam'
            : 'tętno w strefie';
  const recent = r.samples.slice(-SPARK_WINDOW);
  const waitingForBelt = r.running && beltWait.current > 0;

  return (
    <section className={r.running ? 'tm-run' : 'tm-run is-paused'}>
      <div className="tm-top">
        <div className="panel wk">
          <div className="lbl">{started ? 'Trening w toku' : 'Gotowy do startu'}</div>
          <h1>{workout.name}</h1>
          <div className="chips">
            <span
              className={tm.state === 'error' ? 'chip bad' : 'chip'}
              title={tm.message ?? (connected ? undefined : 'Bez połączenia z bieżnią trening działa jako stoper: ustawiaj prędkość ręcznie na konsoli.')}
            >
              <span className={connected ? 'dot' : tm.state === 'reconnecting' || tm.state === 'connecting' ? 'dot warn' : 'dot off'} />
              {tm.label || 'Bieżnia'}
              {!connected && tm.state !== 'error' && ' · niepołączona, tryb stopera'}
              {tm.state === 'error' && ' · błąd'}
            </span>
            <span className="chip">
              <span className={ble.heartRate.state === 'connected' ? 'dot' : 'dot off'} />
              {ble.heartRate.state === 'connected' ? ble.heartRate.label || 'Pas tętna' : 'Tętno z bieżni'}
            </span>
            {started && !r.running && !r.finished && <span className="chip paused-tag">Pauza</span>}
            {waitingForBelt && <span className="chip paused-tag">Czekam, aż taśma ruszy…</span>}
          </div>
          {tm.message && tm.state === 'error' && <p className="err small">{tm.message}</p>}
        </div>
        <div className="panel clock">
          <div className="lbl">Czas</div>
          <div className="num">{fmtTime(r.elapsed)}</div>
        </div>
        <div className="panel clock">
          <div className="lbl">Do końca</div>
          <div className="num">{fmtTime(r.total - r.elapsed)}</div>
        </div>
      </div>

      <div className="tm-grid">
        <div className="panel tile stage" style={{ '--zc': speedColor(target) } as React.CSSProperties}>
          <div className="lbl">Odcinek {r.index + 1}/{workout.intervals.length}</div>
          <div className="stage-name">{it.label}</div>
          <div className="target">
            <div className="lbl">{hrRange ? `Prędkość · utrzymuję tętno ${hrRange.id}` : 'Prędkość docelowa'}</div>
            <div className="num">
              {pl(target, 1)}
              <span className="unit">km/h</span>
              {nextS !== null && (
                <span className={`next-tgt ${changeOf(target, nextS)}`} title="Prędkość następnego odcinka">
                  → {pl(nextS, 1)}
                </span>
              )}
            </div>
            <div className="sub">
              {hrRange && `strefa ${hrRange.from}–${hrRange.to} bpm · ${hrHint} · `}
              tempo {paceText(target)} /km
              {it.incline != null && ` · nachylenie ${pl(it.incline, 1)}%`}
              {r.offset !== 0 && ` · korekta ${r.offset > 0 ? '+' : '−'}${pl(Math.abs(r.offset), 1)}`}
            </div>
          </div>
          <div className={!r.finished && r.intervalRemaining <= 5 ? 'stage-left ending' : 'stage-left'}>
            <div className="lbl">Do końca odcinka</div>
            <div className="num">{fmtTime(r.intervalRemaining)}</div>
          </div>
          <div className="bar">
            <span style={{ width: `${(r.intervalElapsed / it.duration) * 100}%` }} />
          </div>
          <div className="next">
            {next ? (
              <>
                Następnie: <b>{next.label}</b> · {next.hrZone != null ? `tętno ${HR_ZONES[next.hrZone]!.id}, start ` : ''}
                {kmh(r.speedOf(r.index + 1))} · {fmtTime(next.duration)}
              </>
            ) : (
              'Ostatni odcinek'
            )}
          </div>
        </div>

        <div className="panel tile tm-speed" style={{ '--zc': speedColor(speed ?? 0) } as React.CSSProperties}>
          <Sparkline
            values={recent.map((x) => x.speed)}
            reference={recent.map((x) => x.target)}
            window={SPARK_WINDOW}
            min={0}
            max={r.maxSpeed * 1.05}
            colorOf={speedColor}
          />
          <div className="lbl">Prędkość bieżni</div>
          <div className="num mega">
            {speed === null ? '–' : pl(speed, 1)}
            <span className="unit">km/h</span>
          </div>
          <div className="tm-sub">
            <span>
              tempo <b>{speed ? paceText(speed) : '–'}</b> /km
            </span>
            {data.current.inclinePct !== null && (
              <span>
                nachylenie <b>{pl(data.current.inclinePct, 1)}%</b>
              </span>
            )}
          </div>
        </div>

        <div className="side">
          <div className={hr > 0 ? 'panel tile metric hr zoned' : 'panel tile metric hr'} style={{ '--zc': `var(--h${hz + 1})` } as React.CSSProperties}>
            <Sparkline
              values={recent.map((x) => (x.hr ? x.hr : null))}
              window={SPARK_WINDOW}
              min={Math.round(maxHr * 0.45)}
              max={maxHr}
              colorOf={(h) => `var(--h${zoneIndex(HR_ZONES, maxHr, h) + 1})`}
            />
            <div className="row">
              <div className="lbl">Tętno</div>
              {hr > 0 && (
                <span className="zchip" style={{ '--zc': `var(--h${hz + 1})` } as React.CSSProperties}>
                  {HR_ZONES[hz]!.id} {HR_ZONES[hz]!.name}
                </span>
              )}
            </div>
            <div className="row">
              <div className="num">
                {hr || '–'}
                <span className="unit">bpm</span>
              </div>
              {hr > 0 && <span className="sub">{Math.round((hr / maxHr) * 100)}% HRmax</span>}
            </div>
          </div>
          <div className="panel tile metric">
            <div className="lbl">Dystans</div>
            <div className="row">
              <div className="num">
                {pl(r.distance / 1000, 2)}
                <span className="unit">km</span>
              </div>
              <span className="sub">śr. {kmh(avgSpeed)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="panel chartbox">
        <TreadmillChart intervals={workout.intervals} progress={r.elapsed} speeds={r.samples.map((s) => s.speed)} />
      </div>

      <div className="controls">
        <button className="btn big primary" type="button" onClick={toggle} disabled={r.finished}>
          {r.running ? 'Pauza' : started ? 'Wznów' : 'Start'}
        </button>
        <button className="btn big" type="button" onClick={skip} disabled={r.finished}>
          Pomiń odcinek
        </button>
        <div className="intensity" role="group" aria-label="Korekta prędkości">
          <button type="button" onClick={() => adjust(-0.5)} aria-label="Zwolnij o 0,5 km/h">
            −0,5
          </button>
          <span>{r.offset === 0 ? '±0' : `${r.offset > 0 ? '+' : '−'}${pl(Math.abs(r.offset), 1)}`}</span>
          <button type="button" onClick={() => adjust(0.5)} aria-label="Przyspiesz o 0,5 km/h" disabled={target >= r.maxSpeed}>
            +0,5
          </button>
        </div>
        <span className="grow" />
        <span className="wallclock" aria-label="Aktualna godzina">
          {new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="grow" />
        <button
          className="btn big"
          type="button"
          aria-pressed={!muted}
          onClick={() => {
            unlockAudio();
            storeMuted(!muted);
            setMuted(!muted);
          }}
        >
          {muted ? 'Dźwięk: wył.' : 'Dźwięk: wł.'}
        </button>
        <button className="btn big" type="button" onClick={fullscreen}>
          {isFull ? 'Zamknij pełny ekran' : 'Pełny ekran'}
        </button>
        <button
          className="btn big danger"
          type="button"
          onClick={() => {
            r.pause();
            void tm.pause();
            setEnding(true);
            redraw();
          }}
        >
          Zakończ
        </button>
      </div>

      {ending && (
        <div className="modal">
          <div className="panel" role="dialog" aria-modal="true" aria-labelledby="tm-end-title">
            <h2 id="tm-end-title">{r.finished ? 'Trening ukończony' : 'Zakończyć trening?'}</h2>
            <div className="stats">
              <Stat k="Czas" v={fmtTime(r.elapsed)} />
              <Stat k="Dystans" v={`${pl(r.distance / 1000, 2)} km`} />
              <Stat k="Śr. prędkość" v={kmh(avgSpeed)} />
              <Stat k="Śr. tętno" v={avgHr ? `${avgHr} bpm` : '–'} />
              <Stat k="Maks. tętno" v={hrs.length ? `${Math.max(...hrs)} bpm` : '–'} />
            </div>
            <p className="muted">
              {r.samples.length ? 'Bieg trafi do historii, skąd pobierzesz plik TCX dla Stravy lub Garmina.' : 'Bieg nie został rozpoczęty, nie ma czego zapisać.'}
            </p>
            {saveError && <p className="err">{saveError}</p>}
            <div className="actions">
              {r.samples.length > 0 && (
                <button className="btn primary" type="button" onClick={save} disabled={saving} autoFocus>
                  {saving ? 'Zapisywanie…' : 'Zapisz sesję'}
                </button>
              )}
              {!r.finished && (
                <button className="btn" type="button" onClick={() => setEnding(false)} disabled={saving}>
                  Wróć do treningu
                </button>
              )}
              {isFull && (
                <button className="btn" type="button" onClick={exitFull} disabled={saving}>
                  Zamknij pełny ekran
                </button>
              )}
              <button className="btn danger" type="button" onClick={finish} disabled={saving}>
                {r.samples.length ? 'Odrzuć bez zapisu' : 'Zamknij'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
