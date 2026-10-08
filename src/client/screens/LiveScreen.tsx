import { useEffect, useRef, useState } from 'react';
import { HR_ZONES, POWER_ZONES, zoneIndex, zoneRanges, type Profile, type ZoneDef } from '../../shared/profile';
import { summarize } from '../../shared/session';
import type { Workout } from '../../shared/workout';
import { saveSession } from '../api';
import { Sparkline } from '../components/Sparkline';
import { Stat } from '../components/Stat';
import { WorkoutChart } from '../components/WorkoutChart';
import type { BleSource } from '../devices/ble';
import { SimulatedSource } from '../devices/simulated';
import type { DataSource, Reading } from '../devices/source';
import { fmtTime, pl } from '../format';
import { WorkoutRunner } from '../session/runner';

interface Props {
  workout: Workout;
  profile: Profile;
  /** sesja zapisana; przejście do historii */
  onSaved: (sessionId: string) => void;
  /** trening porzucony bez zapisu */
  onDiscard: () => void;
  /** urządzenia Bluetooth; null = tryb symulacji */
  ble: BleSource | null;
}

const POWER_AVG_WINDOW = 3;
/** okno wykresów w tle kafelków, s */
const SPARK_WINDOW = 180;

export function LiveScreen({ workout, profile, onSaved, onDiscard, ble }: Props) {
  const runner = useRef<WorkoutRunner>();
  runner.current ??= new WorkoutRunner(workout, profile.ftp);
  const source = useRef<DataSource>();
  source.current ??= ble ?? new SimulatedSource({ ftp: profile.ftp, maxHr: profile.maxHr });
  const latest = useRef<Reading>({});
  const powerBuf = useRef<number[]>([]);
  const [, setFrame] = useState(0);
  const [ending, setEnding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redraw = () => setFrame((f) => f + 1);

  const r = runner.current;
  const src = source.current;

  useEffect(() => {
    const off = src.onReading((x) => {
      latest.current = { ...latest.current, ...x };
      if (x.power === null) powerBuf.current = [];
      else if (x.power !== undefined) {
        powerBuf.current.push(x.power);
        if (powerBuf.current.length > POWER_AVG_WINDOW) powerBuf.current.shift();
      }
    });
    const offChange = src.onChange(redraw);
    void src.connect().then(redraw);
    const timer = setInterval(() => {
      if (r.running) {
        r.tick(latest.current);
        src.setTargetPower(r.targetWatts());
        if (r.finished) setEnding(true);
      }
      redraw();
    }, 1000);
    return () => {
      clearInterval(timer);
      off();
      offChange();
      // Trenażer zostaje sparowany na kolejne treningi, ale wraca do jazdy swobodnej.
      src.setTargetPower(null);
      if (src.id === 'sim') src.disconnect();
    };
  }, [r, src]);

  // Ekran nie gaśnie w trakcie jazdy (tam, gdzie przeglądarka to wspiera).
  useEffect(() => {
    if (!r.running || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    return () => void lock?.release();
  }, [r.running]);

  const toggle = () => {
    if (r.running) r.pause();
    else {
      r.start();
      src.setTargetPower(r.targetWatts());
    }
    redraw();
  };
  const skip = () => {
    r.skipSegment();
    src.setTargetPower(r.targetWatts());
    if (r.finished) setEnding(true);
    redraw();
  };
  const bias = (d: number) => {
    r.adjustBias(d);
    src.setTargetPower(r.targetWatts());
    redraw();
  };
  const stop = () => {
    r.pause();
    setEnding(true);
    redraw();
  };
  // Etykieta przycisku podąża za stanem pełnego ekranu, także po wyjściu klawiszem Esc.
  const [isFull, setIsFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const s = await saveSession({
        workoutId: workout.id,
        workoutName: workout.name,
        startedAt: (r.startedAt ?? new Date()).toISOString(),
        ftp: profile.ftp,
        maxHr: profile.maxHr,
        weight: profile.weight,
        source: src.id,
        segments: workout.segments,
        samples: r.samples,
      });
      if (document.fullscreenElement) void document.exitFullscreen();
      onSaved(s.id);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  // --- wartości do wyświetlenia ---
  const seg = r.segment;
  const next = r.workout.segments[r.segmentIndex + 1];
  const tgtPct = r.targetPct();
  const tgtW = r.targetWatts();
  const ramp = seg.p0 !== null && seg.p1 !== null && seg.p0 !== seg.p1;
  const W = (p: number | null) => (p === null ? null : Math.round(p * r.bias * profile.ftp));

  const buf = powerBuf.current;
  const power = buf.length ? Math.round(buf.reduce((a, b) => a + b, 0) / buf.length) : 0;
  const pz = zoneIndex(POWER_ZONES, profile.ftp, power);
  const hr = latest.current.hr ?? 0;
  const hz = zoneIndex(HR_ZONES, profile.maxHr, hr);
  const cadence = latest.current.cadence ?? 0;
  const recent = r.samples.slice(-SPARK_WINDOW);
  // „Do końca etapu” ma szerokość najdłuższego etapu treningu (m:ss, mm:ss albo h:mm:ss).
  const longestSeg = Math.max(...workout.segments.map((s) => s.duration));
  const segClockChars = longestSeg >= 3600 ? 7 : longestSeg >= 600 ? 5 : 4;
  const sparkPowerMax = Math.max(profile.ftp * 1.3, ...recent.map((s) => Math.max(s.power ?? 0, s.target ?? 0))) * 1.05;
  const cadAvg = r.samples.length
    ? Math.round(r.samples.reduce((a, s) => a + (s.cadence ?? 0), 0) / r.samples.length)
    : null;
  const tz = tgtPct === null ? null : zoneIndex(POWER_ZONES, 100, tgtPct * 100);
  const delta = tgtW === null ? null : power - tgtW;
  const started = r.startedAt !== null;
  const summary = ending ? summarize(r.samples, profile.ftp) : null;

  return (
    <section className={r.running ? 'live' : 'live is-paused'}>
      <div className="live-top">
        <div className="panel wk">
          <div className="lbl">{started ? 'Trening w toku' : 'Gotowy do startu'}</div>
          <h1>{workout.name}</h1>
          <div className="chips">
            <span className="chip" title="Trenażer sam ustawia opór pod moc docelową">
              {tgtW === null ? 'Jazda swobodna' : 'Tryb ERG'}
            </span>
            {src.devices().map((d) => (
              <span className={d.state === 'error' ? 'chip bad' : 'chip'} key={d.kind} title={d.message}>
                <span className={d.connected ? 'dot' : d.state === 'reconnecting' || d.state === 'connecting' ? 'dot warn' : 'dot off'} />
                {d.label}
                {d.state === 'reconnecting' && ' · łączenie…'}
                {d.state === 'error' && ' · błąd'}
              </span>
            ))}
            {started && !r.running && !r.finished && <span className="chip paused-tag">Pauza</span>}
          </div>
        </div>
        <div className="panel clock" style={{ '--clock-chars': r.total >= 3600 ? 7 : 5 } as React.CSSProperties}>
          <div className="lbl">Czas treningu</div>
          <div className="num">{fmtTime(r.elapsed)}</div>
        </div>
        <div className="panel clock" style={{ '--clock-chars': r.total >= 3600 ? 7 : 5 } as React.CSSProperties}>
          <div className="lbl">Do końca</div>
          <div className="num">{fmtTime(r.total - r.elapsed)}</div>
        </div>
      </div>

      <div className="live-grid">
        <div className="panel tile stage" style={{ '--zc': tz === null ? 'var(--dim)' : `var(--z${tz + 1})` } as React.CSSProperties}>
          <div className="lbl">Etap</div>
          <div className="stage-name">{seg.label}</div>
          <div className="target">
            <div className="lbl">Moc docelowa</div>
            <div className="num">
              <Fixed d={3}>{tgtW ?? '–'}</Fixed>
              <span className="unit">W</span>
            </div>
            <div className="sub">
              {tgtPct === null
                ? 'bez celu, jedź swobodnie'
                : ramp
                  ? `rampa ${W(seg.p0)} → ${W(seg.p1)} W · ${Math.round(tgtPct * 100)}% FTP`
                  : `${Math.round(tgtPct * 100)}% FTP`}
            </div>
          </div>
          <div className="stage-left">
            <div className="lbl">Do końca etapu</div>
            <div className="num">
              <Fixed d={segClockChars} left>
                {fmtTime(r.segmentRemaining)}
              </Fixed>
            </div>
          </div>
          <div className="bar">
            <span style={{ width: `${(r.segmentElapsed / seg.duration) * 100}%` }} />
          </div>
          <div className="next">
            {next ? (
              <>
                Następnie: <b>{next.label}</b> ·{' '}
                {next.p0 === null || next.p1 === null
                  ? 'swobodnie'
                  : next.p0 !== next.p1
                    ? `${W(next.p0)}→${W(next.p1)} W`
                    : `${W(next.p0)} W`}{' '}
                · {fmtTime(next.duration)}
              </>
            ) : (
              'Ostatni etap'
            )}
          </div>
        </div>

        <div className="panel tile power" style={{ '--zc': `var(--z${pz + 1})` } as React.CSSProperties}>
          <Sparkline
            values={recent.map((s) => s.power)}
            reference={recent.map((s) => s.target)}
            window={SPARK_WINDOW}
            min={0}
            max={sparkPowerMax}
            color="var(--zc)"
          />
          <div className="head">
            <div className="lbl">Moc · śr. 3 s</div>
            <span className="zchip">
              {POWER_ZONES[pz]!.id} {POWER_ZONES[pz]!.name}
            </span>
          </div>
          <div className="num mega">
            <Fixed d={3}>{power}</Fixed>
            <span className="unit">W</span>
          </div>
          <div className="delta">
            {delta !== null && (
              <>
                cel{' '}
                <b>
                  <Fixed d={3}>{tgtW}</Fixed> W
                </b>{' '}
                · <Fixed d={4}>{`${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta)}`}</Fixed> W ·{' '}
              </>
            )}
            <Fixed d={4}>{pl(power / profile.weight, 1)}</Fixed> W/kg
          </div>
          <ZoneScale zones={POWER_ZONES} reference={profile.ftp} value={power} color={(i) => `var(--z${i + 1})`} ticks={POWER_ZONES.map((z) => z.id)} />
        </div>

        <div className="side">
          <div className="panel tile metric">
            <Sparkline values={recent.map((s) => s.cadence)} window={SPARK_WINDOW} min={40} max={130} color="var(--accent)" />
            <div className="lbl">Kadencja</div>
            <div className="row">
              <div className="num">
                <Fixed d={3}>{cadence}</Fixed>
                <span className="unit">rpm</span>
              </div>
              {cadAvg !== null && (
                <span className="sub">
                  śr. <Fixed d={3}>{cadAvg}</Fixed>
                </span>
              )}
            </div>
          </div>
          <div className="panel tile metric hr">
            <Sparkline
              values={recent.map((s) => (s.hr ? s.hr : null))}
              window={SPARK_WINDOW}
              min={Math.round(profile.maxHr * 0.45)}
              max={profile.maxHr}
              color="var(--hr)"
            />
            <div className="row">
              <div className="lbl">Tętno</div>
              <span className="zchip" style={{ '--zc': `var(--h${hz + 1})` } as React.CSSProperties}>
                {HR_ZONES[hz]!.id} {HR_ZONES[hz]!.name}
              </span>
            </div>
            <div className="row">
              <div className="num">
                <Fixed d={3}>{hr || '–'}</Fixed>
                <span className="unit">bpm</span>
              </div>
              {hr > 0 && (
                <span className="sub">
                  <Fixed d={3}>{Math.round((hr / profile.maxHr) * 100)}</Fixed>% HRmax
                </span>
              )}
            </div>
            <ZoneScale
              zones={HR_ZONES}
              reference={profile.maxHr}
              value={hr}
              color={(i) => `var(--h${i + 1})`}
              ticks={zoneRanges(HR_ZONES, profile.maxHr).map((z) => String(z.from))}
            />
          </div>
        </div>
      </div>

      <div className="panel chartbox">
        <div className="legend">
          <span className="lbl grow">Przebieg treningu</span>
          <span>
            <i style={{ background: 'var(--fg)' }} />
            moc rzeczywista
          </span>
          <span>
            <i style={{ background: 'var(--hr)' }} />
            tętno
          </span>
          <span>
            <i style={{ background: 'var(--accent)' }} />
            teraz
          </span>
        </div>
        <WorkoutChart className="live-chart" segments={workout.segments} ftp={profile.ftp} maxHr={profile.maxHr} progress={r.elapsed} samples={r.samples} />
      </div>

      <div className="controls">
        <button className="btn big primary" type="button" onClick={toggle} disabled={r.finished}>
          {r.running ? 'Pauza' : started ? 'Wznów' : 'Start'}
        </button>
        <button className="btn big" type="button" onClick={skip} disabled={r.finished}>
          Pomiń etap
        </button>
        <div className="intensity" role="group" aria-label="Intensywność">
          <button type="button" onClick={() => bias(-0.05)} aria-label="Zmniejsz intensywność o 5%">
            −5%
          </button>
          <span>{Math.round(r.bias * 100)}%</span>
          <button type="button" onClick={() => bias(0.05)} aria-label="Zwiększ intensywność o 5%">
            +5%
          </button>
        </div>
        <span className="grow" />
        <button className="btn big" type="button" onClick={fullscreen}>
          {isFull ? 'Zamknij pełny ekran' : 'Pełny ekran'}
        </button>
        <button className="btn big danger" type="button" onClick={stop}>
          Zakończ
        </button>
      </div>

      {ending && summary && (
        <div className="modal">
          <div className="panel" role="dialog" aria-modal="true" aria-labelledby="end-title">
            <h2 id="end-title">{r.finished ? 'Trening ukończony' : 'Zakończyć trening?'}</h2>
            <div className="stats">
              <Stat k="Czas" v={fmtTime(summary.duration)} />
              <Stat k="Śr. moc" v={`${summary.avgPower} W`} />
              <Stat k="NP" v={`${summary.np} W`} />
              <Stat k="TSS" v={String(Math.round(summary.tss))} />
              <Stat k="Śr. tętno" v={summary.avgHr ? `${summary.avgHr} bpm` : '–'} />
            </div>
            <p className="muted">
              {r.samples.length
                ? 'Sesja trafi do historii, skąd pobierzesz plik TCX lub GPX.'
                : 'Trening nie został rozpoczęty, nie ma czego zapisać.'}
            </p>
            {error && <p className="err">{error}</p>}
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
              <button className="btn danger" type="button" onClick={onDiscard} disabled={saving}>
                {r.samples.length ? 'Odrzuć bez zapisu' : 'Zamknij'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ZoneScale(props: { zones: readonly ZoneDef[]; reference: number; value: number; color: (i: number) => string; ticks: string[] }) {
  const ranges = zoneRanges(props.zones, props.reference);
  const idx = zoneIndex(props.zones, props.reference, props.value);
  const z = ranges[idx]!;
  const hi = z.to ?? z.from + (z.from - (ranges[idx - 1]?.from ?? 0));
  const frac = Math.min(0.98, Math.max(0.02, (props.value - z.from) / Math.max(1, hi - z.from)));
  return (
    <div className="scale" aria-hidden="true">
      <div className="mk" style={{ left: `${((idx + frac) / ranges.length) * 100}%` }} />
      <div className="segs" style={{ gridTemplateColumns: `repeat(${ranges.length}, 1fr)` }}>
        {ranges.map((r, i) => (
          <span key={r.id} className={i === idx ? 'on' : undefined} style={{ background: props.color(i) }} />
        ))}
      </div>
      <div className="ticks">
        {props.ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}


/**
 * Liczba o stałej szerokości (w znakach cyfry), wyrównana do prawej, żeby jednostka i sąsiednie elementy
 * nie przesuwały się przy zmianie liczby cyfr (np. 99 → 100 W).
 */
function Fixed({ d, left, children }: { d: number; left?: boolean; children: React.ReactNode }) {
  return (
    <span className={left ? 'fx left' : 'fx'} style={{ '--d': d } as React.CSSProperties}>
      {children}
    </span>
  );
}
