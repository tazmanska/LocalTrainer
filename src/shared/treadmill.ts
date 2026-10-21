// Treningi interwałowe na bieżnię: model, walidacja i statystyki. Kod współdzielony przez serwer i przeglądarkę.

/** Najwyższa prędkość, jaką aplikacja ustawi na bieżni, km/h. */
export const TREADMILL_MAX_KPH = 12;
/** Najniższa prędkość odcinka, km/h (spacer). */
export const TREADMILL_MIN_KPH = 1;
export const TREADMILL_MAX_INCLINE = 15;
export const TREADMILL_MIN_INCLINE = -3;

export interface TreadmillInterval {
  label: string;
  /** czas trwania, s */
  duration: number;
  /** prędkość docelowa, km/h */
  speed: number;
  /** nachylenie w %; null/brak = bez zmiany nachylenia */
  incline?: number | null;
  /**
   * Strefa tętna (indeks w HR_ZONES, 0 = Z1) utrzymywana przez aplikację: prędkość startuje od `speed`
   * i jest powoli zmieniana tak, żeby tętno zostało w strefie; null/brak = stała prędkość.
   */
  hrZone?: number | null;
}

export interface TreadmillWorkout {
  id: string;
  name: string;
  intervals: TreadmillInterval[];
  /** ISO 8601 */
  updatedAt: string;
}

export type TreadmillWorkoutInput = Pick<TreadmillWorkout, 'name' | 'intervals'>;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Sprawdza dane z formularza lub żądania; zwraca znormalizowany trening albo komunikat błędu. */
export function validateTreadmillWorkout(input: unknown): { workout: TreadmillWorkoutInput } | { error: string } {
  const o = input as Partial<TreadmillWorkoutInput> | null;
  const name = typeof o?.name === 'string' ? o.name.trim() : '';
  if (!name) return { error: 'Podaj nazwę treningu.' };
  if (name.length > 80) return { error: 'Nazwa może mieć najwyżej 80 znaków.' };
  if (!Array.isArray(o?.intervals) || !o.intervals.length) return { error: 'Dodaj co najmniej jeden odcinek.' };
  if (o.intervals.length > 200) return { error: 'Trening może mieć najwyżej 200 odcinków.' };
  const intervals: TreadmillInterval[] = [];
  for (const [i, raw] of o.intervals.entries()) {
    const n = i + 1;
    const it = raw as Partial<TreadmillInterval> | null;
    const duration = Number(it?.duration);
    const speed = Number(it?.speed);
    if (!Number.isFinite(duration) || duration < 5 || duration > 4 * 3600) return { error: `Odcinek ${n}: czas od 5 s do 4 h.` };
    if (!Number.isFinite(speed) || speed < TREADMILL_MIN_KPH || speed > TREADMILL_MAX_KPH) {
      return { error: `Odcinek ${n}: prędkość od ${TREADMILL_MIN_KPH} do ${TREADMILL_MAX_KPH} km/h.` };
    }
    let incline: number | null = null;
    if (it?.incline !== undefined && it.incline !== null) {
      incline = Number(it.incline);
      if (!Number.isFinite(incline) || incline < TREADMILL_MIN_INCLINE || incline > TREADMILL_MAX_INCLINE) {
        return { error: `Odcinek ${n}: nachylenie od ${TREADMILL_MIN_INCLINE} do ${TREADMILL_MAX_INCLINE}%.` };
      }
      incline = round1(incline);
    }
    const label = typeof it?.label === 'string' && it.label.trim() ? it.label.trim().slice(0, 40) : `Odcinek ${n}`;
    let hrZone: number | null = null;
    if (it?.hrZone !== undefined && it.hrZone !== null) {
      hrZone = Number(it.hrZone);
      if (!Number.isInteger(hrZone) || hrZone < 0 || hrZone > 4) return { error: `Odcinek ${n}: strefa tętna od Z1 do Z5.` };
    }
    intervals.push({ label, duration: Math.round(duration), speed: round1(speed), incline, ...(hrZone !== null ? { hrZone } : {}) });
  }
  return { workout: { name, intervals } };
}

export function intervalStarts(intervals: readonly TreadmillInterval[]): number[] {
  let t = 0;
  return intervals.map((s) => {
    const start = t;
    t += s.duration;
    return start;
  });
}

export function treadmillStats(intervals: readonly TreadmillInterval[]) {
  const duration = intervals.reduce((a, s) => a + s.duration, 0);
  const distanceKm = intervals.reduce((a, s) => a + (s.speed * s.duration) / 3600, 0);
  const maxSpeed = intervals.reduce((a, s) => Math.max(a, s.speed), 0);
  return { duration, distanceKm, maxSpeed, avgSpeed: duration ? (distanceKm * 3600) / duration : 0 };
}

/** Blok powtórzeń: N × (praca, odpoczynek); po ostatniej pracy nie ma odpoczynku. */
export function repeatBlock(
  reps: number,
  work: { duration: number; speed: number; incline?: number | null },
  rest: { duration: number; speed: number; incline?: number | null },
): TreadmillInterval[] {
  const out: TreadmillInterval[] = [];
  for (let i = 1; i <= reps; i++) {
    out.push({ label: `Bieg ${i}/${reps}`, ...work });
    if (i < reps && rest.duration > 0) out.push({ label: `Przerwa ${i}/${reps - 1}`, ...rest });
  }
  return out;
}

/** Tempo w min/km dla prędkości w km/h, np. 10 km/h → „6:00”. */
export function paceText(kph: number): string {
  if (kph < 0.5) return '–';
  const s = Math.round(3600 / kph);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
