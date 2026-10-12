import { describe, expect, it } from 'vitest';
import { paceText, repeatBlock, treadmillStats, validateTreadmillWorkout } from './treadmill';

describe('treningi na bieżnię', () => {
  it('waliduje i normalizuje trening', () => {
    const v = validateTreadmillWorkout({ name: ' Interwały ', intervals: [{ label: '', duration: 60.4, speed: 9.96, incline: '2' }] });
    expect(v).toEqual({ workout: { name: 'Interwały', intervals: [{ label: 'Odcinek 1', duration: 60, speed: 10, incline: 2 }] } });
  });

  it('odrzuca prędkość powyżej 12 km/h, pusty trening i brak nazwy', () => {
    expect(validateTreadmillWorkout({ name: 'x', intervals: [{ duration: 60, speed: 12.1 }] })).toEqual({ error: expect.stringMatching(/12 km\/h/) });
    expect(validateTreadmillWorkout({ name: 'x', intervals: [] })).toHaveProperty('error');
    expect(validateTreadmillWorkout({ name: '', intervals: [{ duration: 60, speed: 8 }] })).toHaveProperty('error');
  });

  it('blok powtórzeń nie kończy się przerwą', () => {
    const b = repeatBlock(3, { duration: 120, speed: 10 }, { duration: 60, speed: 6 });
    expect(b.map((x) => x.label)).toEqual(['Bieg 1/3', 'Przerwa 1/2', 'Bieg 2/3', 'Przerwa 2/2', 'Bieg 3/3']);
  });

  it('liczy czas, dystans i tempo', () => {
    expect(treadmillStats([{ label: 'a', duration: 1800, speed: 10 }, { label: 'b', duration: 1800, speed: 6 }])).toEqual({
      duration: 3600,
      distanceKm: 8,
      maxSpeed: 10,
      avgSpeed: 8,
    });
    expect(paceText(10)).toBe('6:00');
    expect(paceText(12)).toBe('5:00');
  });
});
