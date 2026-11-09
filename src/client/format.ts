import { POWER_ZONES, zoneIndex } from '../shared/profile';
import { CADENCE_OK, CADENCE_WARN } from '../shared/workout';

export const pl = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');

/** 0:45, 12:05, 1:02:30 */
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}

/** 45 min, 1 h 30 min */
export function fmtMinutes(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** Kolor strefy mocy dla ułamka FTP; null (jazda swobodna) dostaje kolor neutralny. */
export function powerColor(pct: number | null): string {
  if (pct === null) return 'var(--dim)';
  return `var(--z${zoneIndex(POWER_ZONES, 100, pct * 100) + 1})`;
}

/** Polska odmiana: 1 sesja, 2 sesje, 5 sesji, 22 sesje. */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `${n} ${one}`;
  const d = n % 10;
  const t = n % 100;
  return `${n} ${d >= 2 && d <= 4 && !(t >= 12 && t <= 14) ? few : many}`;
}

/** Porównanie celu następnego etapu z bieżącym; brak któregoś (jazda swobodna, ostatni etap) = bez zmiany. */
export function changeOf(current: number | null, next: number | null | undefined): 'up' | 'down' | 'same' {
  if (current === null || next === null || next === undefined || next === current) return 'same';
  return next > current ? 'up' : 'down';
}

export type Level = 'good' | 'warn' | 'bad';

/** Balans L/P: różnica między nogami w pkt % (51/49 → 2): do 2 dobrze, do 4 uwaga, od 6 źle. */
export function balanceLevel(leftPct: number): Level {
  const l = Math.round(leftPct);
  const diff = Math.abs(l - (100 - l));
  return diff <= 2 ? 'good' : diff < 6 ? 'warn' : 'bad';
}

/** Kadencja na etapie z celem: do ±3 rpm dobrze, do ±6 uwaga, dalej źle. */
export function cadenceTargetLevel(rpm: number, target: number): Level {
  const diff = Math.abs(Math.round(rpm) - target);
  return diff <= CADENCE_OK ? 'good' : diff <= CADENCE_WARN ? 'warn' : 'bad';
}

/** Kadencja: powyżej 85 dobrze, 81–85 uwaga, 80 i mniej źle. */
export function cadenceLevel(rpm: number): Level {
  return rpm > 85 ? 'good' : rpm > 80 ? 'warn' : 'bad';
}
