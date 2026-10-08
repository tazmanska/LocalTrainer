import { useEffect, useMemo, useState } from 'react';
import { HR_ZONES, POWER_ZONES, zoneIndex } from '../../shared/profile';
import { timeInZones, type Session, type SessionListItem } from '../../shared/session';
import { deleteSession, exportUrl, getSession, listSessions } from '../api';
import { WorkoutChart } from '../components/WorkoutChart';
import { fmtTime, pl, plural } from '../format';
import { Stat } from '../components/Stat';

const DAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function HistoryScreen({ initialId }: { initialId?: string }) {
  const [items, setItems] = useState<SessionListItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [detail, setDetail] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSessions()
      .then((xs) => {
        setItems(xs);
        setSelected((cur) => cur ?? xs[0]?.id ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selected) return setDetail(null);
    let live = true;
    getSession(selected)
      .then((s) => live && setDetail(s))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [selected]);

  async function remove(id: string) {
    try {
      await deleteSession(id);
      const rest = (items ?? []).filter((x) => x.id !== id);
      setItems(rest);
      setSelected(rest[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="hist">
      <div className="panel hlist">
        <div className="hd">
          <h2>Historia</h2>
          {items && <span className="lbl">{plural(items.length, 'sesja', 'sesje', 'sesji')}</span>}
        </div>
        {error && <p className="err pad">{error}</p>}
        {items?.length === 0 && <p className="muted pad">Brak zapisanych sesji. Ukończ trening, żeby pojawił się tutaj.</p>}
        <div role="listbox" aria-label="Zapisane sesje">
          {items?.map((s) => (
            <button key={s.id} type="button" className="hrow" role="option" aria-selected={s.id === selected} onClick={() => setSelected(s.id)}>
              <div>
                <div className="d">{fmtDate(s.startedAt)}</div>
                <div className="n">{s.workoutName}</div>
              </div>
              <div className="tss">
                {Math.round(s.summary.tss)}
                <small>TSS</small>
              </div>
              <div className="s">
                <span>{fmtTime(s.summary.duration)}</span>
                <span>{s.summary.avgPower} W</span>
                <span>NP {s.summary.np} W</span>
                {s.summary.avgHr && <span>♥ {s.summary.avgHr}</span>}
                {s.source === 'sim' && <span>symulacja</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
      {detail && detail.id === selected ? (
        <SessionDetail key={detail.id} s={detail} onDelete={() => remove(detail.id)} />
      ) : (
        <div className="panel detail placeholder">{selected ? 'Wczytywanie…' : 'Wybierz sesję z listy.'}</div>
      )}
    </div>
  );
}

function SessionDetail({ s, onDelete }: { s: Session; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const sum = s.summary;
  const pz = useMemo(
    () => timeInZones(s.samples, POWER_ZONES.length, (x) => (x.power === null ? null : zoneIndex(POWER_ZONES, s.ftp, x.power))),
    [s],
  );
  const hz = useMemo(
    () => timeInZones(s.samples, HR_ZONES.length, (x) => (x.hr ? zoneIndex(HR_ZONES, s.maxHr, x.hr) : null)),
    [s],
  );

  return (
    <div className="panel detail">
      <div className="hd">
        <div>
          <div className="lbl">{fmtDate(s.startedAt)}</div>
          <h2 className="title">{s.workoutName}</h2>
          <div className="file">
            FTP w dniu treningu: {s.ftp} W · HRmax {s.maxHr}
            {s.source === 'sim' && ' · dane z symulacji'}
          </div>
        </div>
        <div className="actions">
          <a className="btn primary" href={exportUrl(s.id, 'tcx')} download title="Strava, Garmin Connect, TrainingPeaks">
            Pobierz TCX
          </a>
          <a className="btn" href={exportUrl(s.id, 'gpx')} download>
            Pobierz GPX
          </a>
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
        <Stat k="Czas" v={fmtTime(sum.duration)} />
        <Stat k="Śr. moc" v={`${sum.avgPower} W`} />
        <Stat k="NP" v={`${sum.np} W`} />
        <Stat k="IF" v={pl(sum.intensity, 2)} />
        <Stat k="TSS" v={String(Math.round(sum.tss))} />
        <Stat k="Praca" v={`${sum.work} kJ`} />
        <Stat k="Śr. tętno" v={sum.avgHr ? `${sum.avgHr} bpm` : '–'} />
        <Stat k="Maks. tętno" v={sum.maxHr ? `${sum.maxHr} bpm` : '–'} />
        <Stat k="Kadencja" v={sum.avgCadence ? `${sum.avgCadence} rpm` : '–'} />
        {sum.avgBalance != null && <Stat k="Balans L/P" v={`${Math.round(sum.avgBalance)} / ${100 - Math.round(sum.avgBalance)}`} />}
      </div>
      <div className="chartbox flat">
        <div className="legend">
          <span className="lbl grow">Moc i tętno na tle planu</span>
          <span>
            <i style={{ background: 'var(--fg)' }} />
            moc
          </span>
          <span>
            <i style={{ background: 'var(--hr)' }} />
            tętno
          </span>
        </div>
        <WorkoutChart segments={s.segments} ftp={s.ftp} maxHr={s.maxHr} samples={s.samples} dim />
      </div>
      <div className="inzones">
        <div className="lbl">Czas w strefach</div>
        <ZoneBar label="Moc" times={pz} color={(i) => `var(--z${i + 1})`} />
        <ZoneBar label="Tętno" times={hz} color={(i) => `var(--h${i + 1})`} />
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Strefa</th>
                {POWER_ZONES.map((z, i) => (
                  <th key={z.id} className="r">
                    <span className="sw" style={{ background: `var(--z${i + 1})` }} />
                    {z.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Moc</td>
                {pz.map((v, i) => (
                  <td key={i} className="r">
                    {fmtTime(v)}
                  </td>
                ))}
              </tr>
              <tr>
                <td>Tętno</td>
                {POWER_ZONES.map((_, i) => (
                  <td key={i} className="r">
                    {i < hz.length ? fmtTime(hz[i]!) : ''}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ZoneBar({ label, times, color }: { label: string; times: number[]; color: (i: number) => string }) {
  return (
    <div className="inz">
      <span>{label}</span>
      <div className="zbar">
        {times.map((v, i) => (v ? <span key={i} title={fmtTime(v)} style={{ flex: v, background: color(i) }} /> : null))}
      </div>
    </div>
  );
}
