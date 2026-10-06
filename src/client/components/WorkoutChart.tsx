import { FREE_RIDE_ASSUMED, segmentStarts, type Segment } from '../../shared/workout';
import { powerColor } from '../format';

interface Props {
  segments: readonly Segment[];
  /** FTP w W; gdy podane, rysowana jest linia FTP z etykietą */
  ftp?: number;
  /** wersja miniaturowa na liście: bez linii FTP i obramowań */
  mini?: boolean;
}

const VW = 1000;
const VH = 200;

/** Profil treningu: każdy etap jako wielokąt w kolorze strefy mocy. */
export function WorkoutChart({ segments, ftp, mini }: Props) {
  const total = segments.reduce((a, s) => a + s.duration, 0) || 1;
  const peak = Math.max(1.3, ...segments.map((s) => Math.max(s.p0 ?? 0, s.p1 ?? 0)) ) * 1.12;
  const starts = segmentStarts(segments);
  const x = (t: number) => (t / total) * VW;
  const y = (p: number) => VH - (p / peak) * VH;

  return (
    <div className={mini ? 'wchart mini' : 'wchart'}>
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
              opacity={free ? 0.45 : 0.8}
              stroke="var(--bg)"
              strokeWidth={mini ? 0 : 1.5}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {!mini && (
          <line x1={0} x2={VW} y1={y(1)} y2={y(1)} stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
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
