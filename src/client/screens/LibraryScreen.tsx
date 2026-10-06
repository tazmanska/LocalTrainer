import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { segmentStarts, workoutStats, type Workout } from '../../shared/workout';
import { deleteWorkout, getProfile, importWorkout, listWorkouts } from '../api';
import { WorkoutChart } from '../components/WorkoutChart';
import { fmtMinutes, fmtTime, pl, powerColor } from '../format';

type Notice = { kind: 'ok' | 'err'; text: string };

export function LibraryScreen() {
  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [ftp, setFtp] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listWorkouts(), getProfile()])
      .then(([ws, p]) => {
        setWorkouts(ws);
        setFtp(p.ftp);
        setSelected(ws[0]?.id ?? null);
      })
      .catch((e: Error) => setNotices([{ kind: 'err', text: e.message }]));
  }, []);

  async function importFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    const out: Notice[] = [];
    let last: Workout | null = null;
    for (const f of list) {
      if (!/\.zwo$/i.test(f.name)) {
        out.push({ kind: 'err', text: `${f.name}: to nie jest plik .zwo` });
        continue;
      }
      try {
        const w = await importWorkout(f.name, await f.text());
        last = w;
        out.push({ kind: 'ok', text: `Wczytano ${w.name}` });
      } catch (e) {
        out.push({ kind: 'err', text: `${f.name}: ${(e as Error).message}` });
      }
    }
    if (last) {
      const ws = await listWorkouts();
      setWorkouts(ws);
      setSelected(last.id);
    }
    setNotices(out);
    setBusy(false);
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void importFiles(e.dataTransfer.files);
  };

  async function onDelete(w: Workout) {
    try {
      await deleteWorkout(w.id);
      const ws = (workouts ?? []).filter((x) => x.id !== w.id);
      setWorkouts(ws);
      setSelected(ws[0]?.id ?? null);
      setNotices([{ kind: 'ok', text: `Usunięto ${w.name}` }]);
    } catch (e) {
      setNotices([{ kind: 'err', text: (e as Error).message }]);
    }
  }

  const current = workouts?.find((w) => w.id === selected) ?? null;

  return (
    <div className="two">
      <div>
        <label
          className={dragging ? 'drop over' : 'drop'}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <strong>{busy ? 'Wczytywanie…' : 'Wczytaj plik treningu'}</strong>
          <span>
            Przeciągnij tutaj pliki <code>.zwo</code> z MyWoosh lub Zwift albo kliknij, aby wybrać
          </span>
          <input
            type="file"
            accept=".zwo"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void importFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {notices.length > 0 && (
          <ul className="notices" aria-live="polite">
            {notices.map((n, i) => (
              <li key={i} className={n.kind}>
                {n.text}
              </li>
            ))}
          </ul>
        )}
        <div className="list" role="listbox" aria-label="Zapisane treningi">
          {workouts === null && !notices.length && <p className="muted">Wczytywanie…</p>}
          {workouts?.length === 0 && <p className="muted">Brak treningów. Wczytaj pierwszy plik .zwo.</p>}
          {workouts?.map((w) => (
            <WorkoutCard key={w.id} w={w} selected={w.id === selected} onSelect={() => setSelected(w.id)} />
          ))}
        </div>
      </div>
      {current ? (
        <WorkoutDetail key={current.id} w={current} ftp={ftp ?? 200} onDelete={() => onDelete(current)} />
      ) : (
        <div className="panel detail placeholder">Wybierz trening z listy albo wczytaj plik.</div>
      )}
    </div>
  );
}

function WorkoutCard({ w, selected, onSelect }: { w: Workout; selected: boolean; onSelect: () => void }) {
  const s = useMemo(() => workoutStats(w.segments), [w]);
  return (
    <button type="button" className="wcard" role="option" aria-selected={selected} onClick={onSelect}>
      <div>
        <div className="wname">{w.name}</div>
        <div className="meta">
          {fmtMinutes(s.duration)} · TSS {Math.round(s.tss)} · IF {pl(s.intensity, 2)}
        </div>
      </div>
      <WorkoutChart segments={w.segments} mini />
    </button>
  );
}

function WorkoutDetail({ w, ftp, onDelete }: { w: Workout; ftp: number; onDelete: () => void }) {
  const s = useMemo(() => workoutStats(w.segments), [w]);
  const starts = useMemo(() => segmentStarts(w.segments), [w]);
  const [confirm, setConfirm] = useState(false);
  const W = (p: number) => Math.round(p * ftp);
  const pct = (p: number) => Math.round(p * 100);

  return (
    <div className="panel detail">
      <div className="hd">
        <div>
          <h2>{w.name}</h2>
          <div className="file">
            {w.fileName}
            {w.author && ` · ${w.author}`}
          </div>
        </div>
        <div className="actions">
          <button className="btn big primary" type="button" disabled title="Sterowanie trenażerem pojawi się w kroku 4">
            Rozpocznij trening
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
      {w.description && <p className="desc">{w.description}</p>}
      <div className="stats">
        <Stat k="Czas" v={fmtMinutes(s.duration)} />
        <Stat k="TSS" v={String(Math.round(s.tss))} />
        <Stat k="IF" v={pl(s.intensity, 2)} />
        <Stat k="Śr. cel" v={`${W(s.avg)} W`} />
        <Stat k="Maks. cel" v={`${W(s.max)} W`} />
      </div>
      <WorkoutChart segments={w.segments} ftp={ftp} />
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Etap</th>
              <th className="r">Start</th>
              <th className="r">Czas</th>
              <th className="r">% FTP</th>
              <th className="r">Moc</th>
              <th className="r">Kadencja</th>
            </tr>
          </thead>
          <tbody>
            {w.segments.map((seg, i) => {
              const free = seg.p0 === null || seg.p1 === null;
              const ramp = !free && seg.p0 !== seg.p1;
              return (
                <tr key={i}>
                  <td>
                    <span className="sw" style={{ background: powerColor(free ? null : (seg.p0! + seg.p1!) / 2) }} />
                    {seg.label}
                  </td>
                  <td className="r">{fmtTime(starts[i]!)}</td>
                  <td className="r">{fmtTime(seg.duration)}</td>
                  <td className="r">{free ? 'swobodnie' : ramp ? `${pct(seg.p0!)}→${pct(seg.p1!)}%` : `${pct(seg.p0!)}%`}</td>
                  <td className="r">{free ? '–' : ramp ? `${W(seg.p0!)}→${W(seg.p1!)} W` : `${W(seg.p0!)} W`}</td>
                  <td className="r">{seg.cadence ? `${seg.cadence} rpm` : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="lbl">{k}</span>
      <span className="num">{v}</span>
    </div>
  );
}
