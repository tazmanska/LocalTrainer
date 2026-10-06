import { POWER_ZONES, zoneIndex } from '../shared/profile';

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
