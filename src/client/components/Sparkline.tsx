interface Props {
  /** wartości od najstarszej do najnowszej; null = brak odczytu */
  values: readonly (number | null)[];
  /** liczba punktów na pełną szerokość (okno czasu w sekundach) */
  window: number;
  min: number;
  max: number;
  color: string;
  /** opcjonalna druga linia, np. moc docelowa, rysowana przerywaną kreską */
  reference?: readonly (number | null)[];
}

const VW = 1000;
const VH = 100;

/** Wykres w tle kafelka: ostatnie `window` sekund, przyklejony do prawej krawędzi (najnowsza wartość przy prawym brzegu). */
export function Sparkline({ values, window, min, max, color, reference }: Props) {
  const span = Math.max(1e-6, max - min);
  const x = (i: number, n: number) => VW - ((n - 1 - i) / Math.max(1, window - 1)) * VW;
  const y = (v: number) => VH - Math.min(1, Math.max(0, (v - min) / span)) * VH;

  /** Odcinki bez przerw w danych; luka (null) przerywa linię zamiast łączyć ją przez zero. */
  const runs = (vals: readonly (number | null)[]) => {
    const out: [number, number][][] = [];
    let cur: [number, number][] = [];
    vals.forEach((v, i) => {
      if (v === null) {
        if (cur.length) out.push(cur);
        cur = [];
      } else cur.push([x(i, vals.length), y(v)]);
    });
    if (cur.length) out.push(cur);
    return out.filter((r) => r.length > 1);
  };

  const pts = (r: [number, number][]) => r.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');

  return (
    <svg className="spark" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" aria-hidden="true" style={{ color }}>
      {runs(values).map((r, i) => (
        <g key={i}>
          <polygon points={`${r[0]![0]},${VH} ${pts(r)} ${r[r.length - 1]![0]},${VH}`} fill="currentColor" opacity={0.13} />
          <polyline points={pts(r)} fill="none" stroke="currentColor" strokeOpacity={0.55} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
      {reference &&
        runs(reference).map((r, i) => (
          <polyline key={`r${i}`} points={pts(r)} fill="none" stroke="var(--fg)" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
        ))}
    </svg>
  );
}
