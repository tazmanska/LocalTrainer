import type { Sample } from '../../shared/session';
import { FREE_RIDE_ASSUMED, segmentStarts, type Segment } from '../../shared/workout';
import { powerColor } from '../format';

interface Props {
  segments: readonly Segment[];
  /** FTP w W; gdy podane, rysowana jest etykieta linii FTP i można nałożyć moc rzeczywistą */
  ftp?: number;
  /** wersja miniaturowa na liście: bez linii FTP i obramowań */
  mini?: boolean;
  /** bieżąca sekunda treningu: przyszłość jest przyciemniona, „teraz” zaznaczone linią */
  progress?: number;
  /** zarejestrowane próbki do nałożenia na plan (moc i tętno) */
  samples?: readonly Sample[];
  maxHr?: number;
  /** przyciemnia plan, żeby nałożone linie były czytelniejsze */
  dim?: boolean;
  className?: string;
}

const VW = 1000;
const VH = 200;
const MAX_POINTS = 600;

/** Uśrednia próbki do co najwyżej MAX_POINTS punktów, żeby wykres godzinnej sesji nie miał 3600 wierzchołków. */
function downsample(samples: readonly Sample[], pick: (s: Sample) => number | null): [number, number][] {
  const step = Math.max(1, Math.ceil(samples.length / MAX_POINTS));
  const out: [number, number][] = [];
  for (let i = 0; i < samples.length; i += step) {
    let sum = 0;
    let n = 0;
    for (let j = i; j < Math.min(samples.length, i + step); j++) {
      const v = pick(samples[j]!);
      if (v !== null) {
        sum += v;
        n++;
      }
    }
    if (n) out.push([samples[i]!.t + step / 2, sum / n]);
  }
  return out;
}

/** Profil treningu: każdy etap jako wielokąt w kolorze strefy mocy, opcjonalnie z mocą i tętnem. */
export function WorkoutChart({ segments, ftp, mini, progress, samples, maxHr, dim, className }: Props) {
  const total = segments.reduce((a, s) => a + s.duration, 0) || 1;
  const peakPlan = Math.max(1.3, ...segments.map((s) => Math.max(s.p0 ?? 0, s.p1 ?? 0)));
  const peakReal = samples && ftp ? Math.max(0, ...samples.map((s) => (s.power ?? 0) / ftp)) : 0;
  const peak = Math.max(peakPlan, Math.min(peakReal, 2.5)) * 1.12;
  const starts = segmentStarts(segments);
  const x = (t: number) => (t / total) * VW;
  const y = (p: number) => VH - (p / peak) * VH;
  const hrMax = maxHr ?? 190;
  const yHr = (h: number) => VH - Math.min(1, Math.max(0, (h - 80) / (hrMax - 70))) * VH;

  const powerLine = samples && ftp ? downsample(samples, (s) => s.power) : [];
  const hrLine = samples ? downsample(samples, (s) => (s.hr && s.hr > 0 ? s.hr : null)) : [];

  return (
    <div className={['wchart', mini && 'mini', className].filter(Boolean).join(' ')}>
      <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden="true">
        {segments.map((s, i) => {
          const t0 = starts[i]!;
          const free = s.p0 === null || s.p1 === null;
          const p0 = s.p0 ?? FREE_RIDE_ASSUMED;
          const p1 = s.p1 ?? FREE_RIDE_ASSUMED;
          return (
            <polygon
              key={i}
              points={`${x(t0)},${VH} ${x(t0)},${y(p0)} ${x(t0 + s.duration)},${y(p1)} ${x(t0 + s.duration)},${VH}`}
              fill={powerColor(free ? null : (p0 + p1) / 2)}
              opacity={free ? 0.45 : dim ? 0.55 : 0.8}
              stroke="var(--bg)"
              strokeWidth={mini ? 0 : 1.5}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {!mini && (
          <line x1={0} x2={VW} y1={y(1)} y2={y(1)} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        {progress !== undefined && (
          <>
            <rect x={x(progress)} y={0} width={Math.max(0, VW - x(progress))} height={VH} fill="var(--bg)" opacity={0.55} />
            <line x1={x(progress)} x2={x(progress)} y1={0} y2={VH} stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </>
        )}
        {powerLine.length > 1 && ftp && (
          <polyline
            points={powerLine.map(([t, p]) => `${x(t)},${y(p / ftp)}`).join(' ')}
            fill="none"
            stroke="var(--fg)"
            strokeWidth={1.4}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hrLine.length > 1 && (
          <polyline
            points={hrLine.map(([t, h]) => `${x(t)},${yHr(h)}`).join(' ')}
            fill="none"
            stroke="var(--hr)"
            strokeWidth={1.6}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {!mini && ftp !== undefined && (
        <span className="ftp" style={{ top: `${(y(1) / VH) * 100}%` }}>
          FTP {ftp} W
        </span>
      )}
    </div>
  );
}
