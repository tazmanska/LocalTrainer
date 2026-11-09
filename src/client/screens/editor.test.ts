import { describe, expect, it } from 'vitest';
import type { Segment } from '../../shared/workout';
import { toSegments, toStages, validateStages, ZONE_PCT } from './WorkoutEditor';
import { POWER_ZONES, zoneIndex } from '../../shared/profile';

describe('edytor treningów rowerowych', () => {
  it('etapy wczytanego treningu wracają bez zmian', () => {
    const segs: Segment[] = [
      { kind: 'warmup', label: 'Rozgrzewka', duration: 600, p0: 0.5, p1: 0.75 },
      { kind: 'on', label: 'Interwał 1/2', duration: 300, p0: 1.05, p1: 1.05, cadence: 95 },
      { kind: 'off', label: 'Przerwa 1/1', duration: 120, p0: 0.5, p1: 0.5 },
      { kind: 'free', label: 'Swobodnie', duration: 60, p0: null, p1: null },
    ];
    expect(toSegments(toStages(segs))).toEqual(segs);
  });

  it('rampa zmieniona na stałą moc staje się równą jazdą', () => {
    const [s] = toSegments([{ label: 'X', kind: 'ramp', duration: 60, from: 80, to: null }]);
    expect(s).toMatchObject({ kind: 'steady', p0: 0.8, p1: 0.8 });
  });

  it('moc wybrana strefą leży w tej strefie', () => {
    ZONE_PCT.forEach((p, i) => expect(zoneIndex(POWER_ZONES, 100, p)).toBe(i));
  });

  it('sprawdza nazwę, czas i zakres mocy', () => {
    expect(validateStages('', [{ label: 'a', kind: 'steady', duration: 60, from: 50, to: null }])).toMatch(/nazwę/);
    expect(validateStages('x', [{ label: 'a', kind: 'steady', duration: 2, from: 50, to: null }])).toMatch(/5 s/);
    expect(validateStages('x', [{ label: 'a', kind: 'steady', duration: 60, from: 600, to: null }])).toMatch(/500/);
    expect(validateStages('x', [{ label: 'a', kind: 'steady', duration: 60, from: 90, to: null }])).toBeNull();
  });

  it('sprawdza zakres kadencji', () => {
    const stage = { label: 'a', kind: 'steady' as const, duration: 60, from: 90, to: null };
    expect(validateStages('x', [{ ...stage, cadence: 90 }])).toBeNull();
    expect(validateStages('x', [{ ...stage, cadence: 9 }])).toMatch(/kadencja/);
  });
});
