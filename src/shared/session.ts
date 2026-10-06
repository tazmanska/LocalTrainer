// Zapisana sesja treningowa i jej podsumowanie. Kod współdzielony przez serwer i przeglądarkę.
import type { Segment } from './workout.js';

/** Jedna sekunda treningu. */
export interface Sample {
  /** sekunda treningu (bez pauz) */
  t: number;
  power: number | null;
  cadence: number | null;
  hr: number | null;
  /** moc docelowa, W; null = jazda swobodna */
  target: number | null;
}

export interface SessionSummary {
  duration: number;
  avgPower: number;
  maxPower: number;
  np: number;
  intensity: number;
  tss: number;
  /** praca, kJ */
  work: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
}

export interface SessionInput {
  workoutId: string;
  workoutName: string;
  /** ISO 8601 */
  startedAt: string;
  ftp: number;
  maxHr: number;
  weight: number;
  /** skąd pochodziły dane: symulacja lub urządzenia BLE */
  source: 'sim' | 'ble';
  segments: Segment[];
  samples: Sample[];
}

export interface Session extends SessionInput {
  id: string;
  summary: SessionSummary;
}

export type SessionListItem = Pick<Session, 'id' | 'workoutName' | 'startedAt' | 'source' | 'summary'>;

const avgOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(samples: readonly Sample[], ftp: number): SessionSummary {
  const power = samples.map((s) => s.power ?? 0);
  const n = power.length;
  const avgPower = n ? power.reduce((a, b) => a + b, 0) / n : 0;

  // Normalized Power: 30-sekundowa średnia krocząca, czwarta potęga, średnia, pierwiastek czwartego stopnia.
  let np = avgPower;
  if (n >= 30) {
    let win = 0;
    let sum4 = 0;
    for (let i = 0; i < n; i++) {
      win += power[i]!;
      if (i >= 30) win -= power[i - 30]!;
      if (i >= 29) sum4 += (win / 30) ** 4;
    }
    np = (sum4 / (n - 29)) ** 0.25;
  }
  const intensity = ftp > 0 ? np / ftp : 0;

  const hrs = samples.map((s) => s.hr).filter((h): h is number => h !== null && h > 0);
  const cads = samples.map((s) => s.cadence).filter((c): c is number => c !== null && c > 0);
  const avgHr = avgOf(hrs);
  const avgCad = avgOf(cads);

  return {
    duration: n,
    avgPower: Math.round(avgPower),
    maxPower: n ? Math.max(...power) : 0,
    np: Math.round(np),
    intensity: Math.round(intensity * 1000) / 1000,
    tss: Math.round((n / 3600) * intensity * intensity * 100 * 10) / 10,
    work: Math.round((avgPower * n) / 1000),
    avgHr: avgHr === null ? null : Math.round(avgHr),
    maxHr: hrs.length ? Math.max(...hrs) : null,
    avgCadence: avgCad === null ? null : Math.round(avgCad),
  };
}

/** Sekundy spędzone w każdej strefie wg funkcji przypisującej indeks strefy. */
export function timeInZones(samples: readonly Sample[], count: number, zoneOf: (s: Sample) => number | null): number[] {
  const out = new Array<number>(count).fill(0);
  for (const s of samples) {
    const z = zoneOf(s);
    if (z !== null) out[z]! += 1;
  }
  return out;
}

const isNum = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const numOrNull = (v: unknown, max: number) => v === null || isNum(v, 0, max);

/** Walidacja danych sesji przysyłanych przez przeglądarkę; zwraca komunikat błędu albo null. */
export function checkSessionInput(b: unknown): string | null {
  if (!b || typeof b !== 'object') return 'Brak danych sesji';
  const o = b as Record<string, unknown>;
  if (typeof o.workoutId !== 'string' || typeof o.workoutName !== 'string') return 'Brak treningu';
  if (typeof o.startedAt !== 'string' || Number.isNaN(Date.parse(o.startedAt))) return 'Niepoprawna data rozpoczęcia';
  if (!isNum(o.ftp, 1, 2000) || !isNum(o.maxHr, 1, 300) || !isNum(o.weight, 1, 400)) return 'Niepoprawny profil';
  if (o.source !== 'sim' && o.source !== 'ble') return 'Niepoprawne źródło danych';
  if (!Array.isArray(o.segments)) return 'Brak etapów treningu';
  if (!Array.isArray(o.samples) || o.samples.length === 0) return 'Sesja nie zawiera danych';
  if (o.samples.length > 24 * 3600) return 'Sesja jest zbyt długa';
  for (const s of o.samples as unknown[]) {
    const x = s as Record<string, unknown>;
    if (!x || !isNum(x.t, 0, 24 * 3600) || !numOrNull(x.power, 5000) || !numOrNull(x.cadence, 300) || !numOrNull(x.hr, 300) || !numOrNull(x.target, 5000)) {
      return 'Niepoprawna próbka danych';
    }
  }
  return null;
}
