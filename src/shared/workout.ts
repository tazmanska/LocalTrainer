// Model treningu (po sparsowaniu pliku ZWO) i statystyki planu. Kod współdzielony przez serwer i przeglądarkę.

export type SegmentKind = 'warmup' | 'cooldown' | 'steady' | 'ramp' | 'on' | 'off' | 'free';

export interface Segment {
  kind: SegmentKind;
  label: string;
  /** czas trwania, s */
  duration: number;
  /** moc docelowa na początku i końcu etapu jako ułamek FTP; null = jazda swobodna (bez ERG) */
  p0: number | null;
  p1: number | null;
  /** docelowa kadencja, rpm */
  cadence?: number;
}

export interface Workout {
  id: string;
  name: string;
  author: string;
  description: string;
  fileName: string;
  importedAt: string;
  segments: Segment[];
}

export interface WorkoutStats {
  /** s */
  duration: number;
  /** współczynnik intensywności planu (NP planu / FTP) */
  intensity: number;
  tss: number;
  /** średnia moc docelowa jako ułamek FTP */
  avg: number;
  /** najwyższa moc docelowa jako ułamek FTP */
  max: number;
}

/** Moc przyjmowana do statystyk dla etapów swobodnych, gdzie plan nie podaje celu. */
export const FREE_RIDE_ASSUMED = 0.5;

export function segmentStarts(segments: readonly Segment[]): number[] {
  let t = 0;
  return segments.map((s) => {
    const start = t;
    t += s.duration;
    return start;
  });
}

/** Moc docelowa (ułamek FTP) w sekundzie t etapu; liniowo dla ramp. */
export function targetAt(s: Segment, t: number): number | null {
  if (s.p0 === null || s.p1 === null) return null;
  const f = s.duration > 0 ? Math.min(1, Math.max(0, t / s.duration)) : 0;
  return s.p0 + (s.p1 - s.p0) * f;
}

export function workoutStats(segments: readonly Segment[]): WorkoutStats {
  const series: number[] = [];
  let max = 0;
  for (const s of segments) {
    for (let t = 0; t < s.duration; t++) {
      const p = targetAt(s, t + 0.5) ?? FREE_RIDE_ASSUMED;
      series.push(p);
      if (p > max) max = p;
    }
  }
  const duration = series.length;
  if (!duration) return { duration: 0, intensity: 0, tss: 0, avg: 0, max: 0 };

  const avg = series.reduce((a, b) => a + b, 0) / duration;
  // Normalized Power: 30-sekundowa średnia krocząca, czwarta potęga, średnia, pierwiastek czwartego stopnia.
  let np: number;
  if (duration < 30) {
    np = avg;
  } else {
    let win = 0;
    let sum4 = 0;
    for (let i = 0; i < duration; i++) {
      win += series[i]!;
      if (i >= 30) win -= series[i - 30]!;
      if (i >= 29) sum4 += (win / 30) ** 4;
    }
    np = (sum4 / (duration - 29)) ** 0.25;
  }
  return { duration, intensity: np, tss: (duration / 3600) * np * np * 100, avg, max };
}
