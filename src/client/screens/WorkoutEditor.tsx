import { useState } from 'react';
import { POWER_ZONES, zoneIndex } from '../../shared/profile';
import { workoutStats, type Segment, type SegmentKind, type Workout } from '../../shared/workout';
import { buildZwo } from '../../shared/zwo-build';
import { deleteWorkout, importWorkout } from '../api';
import { DurationInput, Stepper } from '../components/DurationInput';
import { Stat } from '../components/Stat';
import { WorkoutChart } from '../components/WorkoutChart';
import { fmtMinutes, pl, powerColor } from '../format';

/** Moc ustawiana po wybraniu strefy, % FTP (mniej więcej środek strefy). */
export const ZONE_PCT = [50, 65, 83, 98, 113, 135, 160] as const;

interface Stage {
  label: string;
  kind: SegmentKind;
  duration: number;
  /** moc na początku etapu, % FTP; null = jazda swobodna */
  from: number | null;
  /** moc na końcu etapu (rampa), % FTP; null = stała moc */
  to: number | null;
  cadence?: number;
}

const pct = (f: number) => Math.round(f * 100);

export function toStages(segments: readonly Segment[]): Stage[] {
  return segments.map((s) => ({
    label: s.label,
    kind: s.kind,
    duration: s.duration,
    from: s.p0 === null ? null : pct(s.p0),
    to: s.p0 === null || s.p1 === null || s.p0 === s.p1 ? null : pct(s.p1),
    ...(s.cadence ? { cadence: s.cadence } : {}),
  }));
}

export function toSegments(stages: readonly Stage[]): Segment[] {
  return stages.map((s) => {
    const free = s.from === null;
    const ramp = !free && s.to !== null && s.to !== s.from;
    const kind: SegmentKind = free ? 'free' : ramp ? (s.kind === 'warmup' || s.kind === 'cooldown' ? s.kind : 'ramp') : s.kind === 'free' || s.kind === 'ramp' ? 'steady' : s.kind;
    const p0 = free ? null : s.from! / 100;
    return {
      kind,
      label: s.label.trim() || 'Etap',
      duration: s.duration,
      p0,
      p1: free ? null : (ramp ? s.to! : s.from!) / 100,
      ...(s.cadence ? { cadence: s.cadence } : {}),
    };
  });
}

/** Etapy N × (praca, przerwa); po ostatniej pracy nie ma przerwy. */
function repeatStages(reps: number, work: { duration: number; pct: number }, rest: { duration: number; pct: number }): Stage[] {
  const out: Stage[] = [];
  for (let i = 1; i <= reps; i++) {
    out.push({ label: `Interwał ${i}/${reps}`, kind: 'on', duration: work.duration, from: work.pct, to: null });
    if (i < reps && rest.duration > 0) out.push({ label: `Przerwa ${i}/${reps - 1}`, kind: 'off', duration: rest.duration, from: rest.pct, to: null });
  }
  return out;
}

const TEMPLATE: Stage[] = [
  { label: 'Rozgrzewka', kind: 'warmup', duration: 600, from: 50, to: 75 },
  ...repeatStages(3, { duration: 300, pct: 98 }, { duration: 180, pct: 50 }),
  { label: 'Schłodzenie', kind: 'cooldown', duration: 300, from: 60, to: 45 },
];

export function validateStages(name: string, stages: readonly Stage[]): string | null {
  if (!name.trim()) return 'Podaj nazwę treningu.';
  if (!stages.length) return 'Dodaj co najmniej jeden etap.';
  for (const [i, s] of stages.entries()) {
    if (s.duration < 5) return `Etap ${i + 1}: czas co najmniej 5 s.`;
    for (const v of [s.from, s.to]) if (v !== null && (!Number.isFinite(v) || v < 0 || v > 500)) return `Etap ${i + 1}: moc od 0 do 500% FTP.`;
  }
  return null;
}

/** Wybór strefy (ustawia moc na środek strefy) albo ręczne % FTP; strefa podąża za wpisanym %. */
function PowerPicker({ value, onChange, ftp, label, allowFree }: { value: number | null; onChange: (v: number | null) => void; ftp: number; label: string; allowFree?: boolean }) {
  const zone = value === null ? 'free' : String(zoneIndex(POWER_ZONES, 100, value));
  return (
    <span className="ed-power">
      <span className="sw" style={{ background: powerColor(value === null ? null : value / 100) }} />
      <select
        aria-label={`${label}: strefa`}
        value={zone}
        onChange={(e) => onChange(e.target.value === 'free' ? null : ZONE_PCT[Number(e.target.value)]!)}
      >
        {POWER_ZONES.map((z, i) => (
          <option key={z.id} value={i}>
            {z.id} {z.name}
          </option>
        ))}
        {allowFree && <option value="free">Swobodnie</option>}
      </select>
      {value !== null && (
        <>
          <Stepper label={`${label}: % FTP`} value={value} onChange={onChange} step={5} min={0} max={500} unit="%" />
          <span className="muted small">{Math.round((value / 100) * ftp)} W</span>
        </>
      )}
    </span>
  );
}

interface Props {
  /** trening do edycji; null = nowy */
  initial: Workout | null;
  ftp: number;
  onCancel: () => void;
  onSaved: (w: Workout) => void;
}

export function WorkoutEditor({ initial, ftp, onCancel, onSaved }: Props) {
  const [name, setName] = useState(initial?.name ?? 'Próg 3×5 min');
  const [stages, setStages] = useState<Stage[]>(() => (initial ? toStages(initial.segments) : TEMPLATE.map((s) => ({ ...s }))));
  const [rep, setRep] = useState({ reps: 4, work: 240, workPct: 113, rest: 120, restPct: 50 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const segments = toSegments(stages);
  const stats = workoutStats(segments);

  const update = (i: number, patch: Partial<Stage>) => setStages((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) =>
    setStages((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const out = [...xs];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });

  async function save() {
    const err = validateStages(name, stages);
    if (err) return setError(err);
    setSaving(true);
    setError(null);
    try {
      const xml = buildZwo({ name: name.trim(), author: initial?.author, description: initial?.description, segments });
      const fileName = initial?.fileName ?? `${name.trim()}.zwo`;
      const w = await importWorkout(fileName, xml);
      // zmieniona treść daje nowe id, więc stara wersja znika z biblioteki
      if (initial && initial.id !== w.id) await deleteWorkout(initial.id);
      onSaved(w);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="panel detail tm-editor">
      <div className="hd">
        <h2>{initial ? 'Edycja treningu' : 'Nowy trening rowerowy'}</h2>
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
        <label htmlFor="ed-name">Nazwa</label>
        <div className="in">
          <input id="ed-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      {error && <p className="err">{error}</p>}
      <div className="stats">
        <Stat k="Czas" v={fmtMinutes(stats.duration)} />
        <Stat k="TSS" v={String(Math.round(stats.tss))} />
        <Stat k="IF" v={pl(stats.intensity, 2)} />
        <Stat k="Etapy" v={String(stages.length)} />
      </div>
      <WorkoutChart segments={segments} ftp={ftp} />
      <div className="ed-stages">
        {stages.map((s, i) => (
          <div className="ed-stage" key={i}>
            <input className="tm-text" value={s.label} maxLength={40} aria-label={`Nazwa etapu ${i + 1}`} onChange={(e) => update(i, { label: e.target.value })} />
            <DurationInput label={`Czas etapu ${i + 1}`} value={s.duration} onChange={(duration) => update(i, { duration })} />
            <PowerPicker
              label={`Moc etapu ${i + 1}`}
              ftp={ftp}
              allowFree
              value={s.from}
              onChange={(from) => update(i, from === null ? { from, to: null } : { from })}
            />
            {s.from !== null &&
              (s.to === null ? (
                <button type="button" className="btn" onClick={() => update(i, { to: s.from })}>
                  rampa
                </button>
              ) : (
                <span className="ed-ramp">
                  <span className="muted small">do</span>
                  <PowerPicker label={`Moc na końcu etapu ${i + 1}`} ftp={ftp} value={s.to} onChange={(to) => update(i, { to })} />
                  <button type="button" className="btn" onClick={() => update(i, { to: null })}>
                    stała moc
                  </button>
                </span>
              ))}
            <span className="tm-rowbtns">
              <button type="button" className="btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Przesuń w górę">
                ↑
              </button>
              <button type="button" className="btn" onClick={() => move(i, 1)} disabled={i === stages.length - 1} aria-label="Przesuń w dół">
                ↓
              </button>
              <button type="button" className="btn danger" onClick={() => setStages((xs) => xs.filter((_, j) => j !== i))} aria-label="Usuń etap">
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
          onClick={() => setStages((xs) => [...xs, { label: `Etap ${xs.length + 1}`, kind: 'steady', duration: 300, from: ZONE_PCT[1], to: null }])}
        >
          Dodaj etap
        </button>
        <div className="tm-rep">
          <span className="lbl">Powtórzenia</span>
          <Stepper label="Liczba powtórzeń" value={rep.reps} onChange={(reps) => setRep({ ...rep, reps })} step={1} min={1} max={30} unit="×" />
          <span className="ed-pair">
            <span className="muted small">praca</span>
            <DurationInput label="Czas pracy" value={rep.work} onChange={(work) => setRep({ ...rep, work })} />
            <PowerPicker label="Moc pracy" ftp={ftp} value={rep.workPct} onChange={(v) => setRep({ ...rep, workPct: v ?? rep.workPct })} />
          </span>
          <span className="ed-pair">
            <span className="muted small">przerwa</span>
            <DurationInput label="Czas przerwy" value={rep.rest} onChange={(rest) => setRep({ ...rep, rest })} />
            <PowerPicker label="Moc przerwy" ftp={ftp} value={rep.restPct} onChange={(v) => setRep({ ...rep, restPct: v ?? rep.restPct })} />
          </span>
          <button
            className="btn"
            type="button"
            onClick={() =>
              setStages((xs) => [...xs, ...repeatStages(rep.reps, { duration: rep.work, pct: rep.workPct }, { duration: rep.rest, pct: rep.restPct })])
            }
          >
            Dodaj blok
          </button>
        </div>
      </div>
    </div>
  );
}
