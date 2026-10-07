import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  HR_ZONES,
  LIMITS,
  POWER_ZONES,
  validateProfile,
  zoneRanges,
  type Profile,
  type ValidationErrors,
  type ZoneRange,
} from '../../shared/profile';
import { ApiValidationError, getProfile, saveProfile } from '../api';
import { CertPanel } from '../components/CertPanel';

type Draft = Record<keyof Profile, string>;

const toDraft = (p: Profile): Draft => ({
  name: p.name,
  ftp: String(p.ftp),
  maxHr: String(p.maxHr),
  weight: String(p.weight).replace('.', ','),
});

const parseNum = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

const fromDraft = (d: Draft) => ({
  name: d.name,
  ftp: parseNum(d.ftp),
  maxHr: parseNum(d.maxHr),
  weight: parseNum(d.weight),
});

const pl = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');

export function ProfileScreen() {
  const [saved, setSaved] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getProfile()
      .then((p) => {
        setSaved(p);
        setDraft(toDraft(p));
      })
      .catch((e: Error) => setStatus({ kind: 'err', text: e.message }));
  }, []);

  // Strefy przeliczają się na żywo z wpisywanych wartości; gdy pole jest niepoprawne, zostaje ostatnia poprawna.
  const live = useMemo(() => {
    if (!draft || !saved) return null;
    const v = fromDraft(draft);
    const ok = (key: 'ftp' | 'maxHr' | 'weight') =>
      Number.isFinite(v[key]) && v[key] >= LIMITS[key].min && v[key] <= LIMITS[key].max;
    return {
      ftp: ok('ftp') ? Math.round(v.ftp) : saved.ftp,
      maxHr: ok('maxHr') ? Math.round(v.maxHr) : saved.maxHr,
      weight: ok('weight') ? v.weight : saved.weight,
    };
  }, [draft, saved]);

  if (!draft || !live) {
    return <div className="panel placeholder">{status ? <p className="err">{status.text}</p> : <p>Wczytywanie profilu…</p>}</div>;
  }

  const set = (key: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft({ ...draft, [key]: e.target.value });
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setStatus(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const { profile, errors: errs } = validateProfile(fromDraft(draft));
    if (!profile) {
      setErrors(errs);
      return;
    }
    setBusy(true);
    try {
      const p = await saveProfile(profile);
      setSaved(p);
      setDraft(toDraft(p));
      setStatus({ kind: 'ok', text: `Zapisano · strefy przeliczone dla FTP ${p.ftp} W i HRmax ${p.maxHr} bpm` });
    } catch (err) {
      if (err instanceof ApiValidationError) setErrors(err.errors);
      else setStatus({ kind: 'err', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const dirty = JSON.stringify(fromDraft(draft)) !== JSON.stringify(fromDraft(toDraft(saved!)));

  return (
    <div className="prof">
      <form className="panel form" onSubmit={onSubmit} noValidate>
        <h2>Profil</h2>
        <Field id="pf-name" label="Imię" error={errors.name}>
          <input id="pf-name" value={draft.name} onChange={set('name')} maxLength={LIMITS.nameLength} autoComplete="given-name" />
        </Field>
        <Field id="pf-ftp" label="FTP" unit="W" big error={errors.ftp} hint="Moc progowa z testu 20 min × 0,95 lub rampy">
          <input id="pf-ftp" inputMode="numeric" value={draft.ftp} onChange={set('ftp')} />
        </Field>
        <Field id="pf-maxhr" label="Tętno maksymalne" unit="bpm" big error={errors.maxHr}>
          <input id="pf-maxhr" inputMode="numeric" value={draft.maxHr} onChange={set('maxHr')} />
        </Field>
        <Field
          id="pf-weight"
          label="Masa ciała"
          unit="kg"
          error={errors.weight}
          hint={`${pl(live.ftp / live.weight, 2)} W/kg przy FTP ${live.ftp} W`}
        >
          <input id="pf-weight" inputMode="decimal" value={draft.weight} onChange={set('weight')} />
        </Field>
        <button className="btn primary" type="submit" disabled={busy || !dirty}>
          {busy ? 'Zapisywanie…' : 'Zapisz profil'}
        </button>
        <div className={status?.kind === 'err' ? 'saved err' : 'saved'} aria-live="polite">
          {status?.text ?? (dirty ? 'Niezapisane zmiany' : '')}
        </div>
      </form>

      <div className="zones">
        <ZonePanel
          title="Strefy mocy"
          caption="% FTP · model Coggana"
          ranges={zoneRanges(POWER_ZONES, live.ftp)}
          unit="W"
          color={(i) => `var(--z${i + 1})`}
          barWeight={(z) => (z.hi === null ? 0.3 : z.hi - z.lo)}
        />
        <ZonePanel
          title="Strefy tętna"
          caption="% HRmax"
          ranges={zoneRanges(HR_ZONES, live.maxHr)}
          unit="bpm"
          color={(i) => `var(--h${i + 1})`}
          barWeight={() => 1}
        />
        <CertPanel />
      </div>
    </div>
  );
}

function Field(props: {
  id: string;
  label: string;
  unit?: string;
  hint?: string;
  error?: string;
  big?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`field${props.big ? ' big-in' : ''}${props.error ? ' invalid' : ''}`}>
      <label htmlFor={props.id}>{props.label}</label>
      <div className="in">
        {props.children}
        {props.unit && <span>{props.unit}</span>}
      </div>
      {props.error ? <div className="hint err">{props.error}</div> : props.hint && <div className="hint">{props.hint}</div>}
    </div>
  );
}

const pct = (x: number) => Math.round(x * 100);

function ZonePanel(props: {
  title: string;
  caption: string;
  ranges: ZoneRange[];
  unit: string;
  color: (i: number) => string;
  barWeight: (z: ZoneRange) => number;
}) {
  const { ranges, unit, color } = props;
  return (
    <section className="panel">
      <div className="zhead">
        <h3>{props.title}</h3>
        <span className="lbl">{props.caption}</span>
      </div>
      <div className="zbar" aria-hidden="true">
        {ranges.map((z, i) => (
          <span key={z.id} style={{ flex: props.barWeight(z), background: color(i) }} />
        ))}
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Strefa</th>
              <th>Nazwa</th>
              <th className="r">%</th>
              <th className="r">{unit === 'W' ? 'Moc' : 'Tętno'}</th>
            </tr>
          </thead>
          <tbody>
            {ranges.map((z, i) => (
              <tr key={z.id}>
                <td className="zcell">
                  <span className="zchip" style={{ '--zc': color(i) } as React.CSSProperties}>
                    {z.id}
                  </span>
                </td>
                <td>{z.name}</td>
                <td className="r">
                  {z.hi === null ? `≥ ${pct(z.lo)}` : i === 0 && z.lo === 0 ? `≤ ${pct(z.hi)}` : `${pct(z.lo)}–${pct(z.hi)}`}%
                </td>
                <td className="r num-cell">
                  {z.to === null ? `≥ ${z.from}` : i === 0 && z.from === 0 ? `≤ ${z.to}` : `${z.from}–${z.to}`} {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
