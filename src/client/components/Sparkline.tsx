interface Props {
  /** wartości od najstarszej do najnowszej; null = brak odczytu */
  values: readonly (number | null)[];
  /** liczba punktów na pełną szerokość (okno czasu w sekundach) */
  window: number;
  min: number;
  max: number;
  /** kolor dla wartości, np. kolor strefy mocy albo tętna */
  colorOf: (v: number) => string;
  /** opcjonalna druga linia, np. moc docelowa, rysowana przerywaną kreską */
  reference?: readonly (number | null)[];
}

const VW = 1000;
const VH = 100;

type Pt = [number, number];

/**
 * Wykres w tle kafelka: ostatnie `window` sekund, najnowsza wartość przy prawym brzegu.
 * Każdy odcinek ma kolor swojej wartości (strefy), a luka w danych przerywa wykres.
 */
export function Sparkline({ values, window, min, max, colorOf, reference }: Props) {
  const span = Math.max(1e-6, max - min);
  const n = values.length;
  const x = (i: number, len: number) => VW - ((len - 1 - i) / Math.max(1, window - 1)) * VW;
  const y = (v: number) => VH - Math.min(1, Math.max(0, (v - min) / span)) * VH;

  // Odcinki o jednym kolorze; sąsiednie odcinki dzielą punkt graniczny, żeby wykres był ciągły.
  const runs: { color: string; pts: Pt[] }[] = [];
  let prev: { pt: Pt; color: string } | null = null;
  values.forEach((v, i) => {
    if (v === null) {
      prev = null;
      return;
    }
    const pt: Pt = [x(i, n), y(v)];
    const color = colorOf(v);
    const last = runs[runs.length - 1];
    if (prev && last && last.color === color) last.pts.push(pt);
    else runs.push({ color, pts: prev ? [prev.pt, pt] : [pt] });
    prev = { pt, color };
  });

  const pts = (r: Pt[]) => r.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');

  const refRuns: Pt[][] = [];
  if (reference) {
    let cur: Pt[] = [];
    reference.forEach((v, i) => {
      if (v === null) {
        if (cur.length > 1) refRuns.push(cur);
        cur = [];
      } else cur.push([x(i, reference.length), y(v)]);
    });
    if (cur.length > 1) refRuns.push(cur);
  }

  return (
    <svg className="spark" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden="true">
      {runs
        .filter((r) => r.pts.length > 1)
        .map((r, i) => (
          <g key={i} style={{ color: r.color }}>
            <polygon points={`${r.pts[0]![0]},${VH} ${pts(r.pts)} ${r.pts[r.pts.length - 1]![0]},${VH}`} fill="currentColor" opacity={0.16} />
            <polyline points={pts(r.pts)} fill="none" stroke="currentColor" strokeOpacity={0.6} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      {refRuns.map((r, i) => (
        <polyline key={`r${i}`} points={pts(r)} fill="none" stroke="var(--fg)" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
