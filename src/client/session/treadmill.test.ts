import { describe, expect, it } from 'vitest';
import { validateTreadmillWorkout, type TreadmillWorkout } from '../../shared/treadmill';
import { TreadmillRunner } from './treadmill';

const workout: TreadmillWorkout = {
  id: 'abc',
  name: 'Test',
  updatedAt: '2026-10-12T00:00:00.000Z',
  intervals: [
    { label: 'Rozgrzewka', duration: 3, speed: 6, incline: null },
    { label: 'Bieg', duration: 2, speed: 11.5, incline: 1 },
    { label: 'Schłodzenie', duration: 2, speed: 5 },
  ],
};

describe('TreadmillRunner', () => {
  it('przechodzi przez odcinki, liczy dystans i kończy trening', () => {
    const r = new TreadmillRunner(workout);
    r.tick({ speed: 6, hr: 100 });
    expect(r.elapsed).toBe(0); // przed startem zegar stoi
    r.start();
    for (let i = 0; i < 3; i++) r.tick({ speed: 6, hr: 120 });
    expect(r.index).toBe(1);
    expect(r.targetSpeed()).toBe(11.5);
    expect(r.targetIncline()).toBe(1);
    expect(r.intervalRemaining).toBe(2);
    r.tick({ speed: null, hr: null }); // bez odczytu dystans liczony z celu
    expect(r.distance).toBeCloseTo((3 * 6 + 11.5) / 3.6);
    r.skip();
    expect(r.index).toBe(2);
    expect(r.targetIncline()).toBeNull();
    r.tick({ speed: 5, hr: 130 });
    r.tick({ speed: 5, hr: 130 });
    expect(r.finished).toBe(true);
    expect(r.running).toBe(false);
    expect(r.samples).toHaveLength(6);
  });

  it('korekta prędkości nie przekracza 12 km/h ani limitu bieżni', () => {
    const r = new TreadmillRunner(workout);
    r.adjust(1);
    expect(r.speedOf(0)).toBe(7);
    expect(r.speedOf(1)).toBe(12);
    const slow = new TreadmillRunner(workout, 10);
    expect(slow.speedOf(1)).toBe(10);
    slow.adjust(-10);
    expect(slow.offset).toBe(-3);
    expect(slow.speedOf(2)).toBe(2);
  });

  it('dystans liczy z licznika bieżni, a po pauzie nie dolicza przejechanych w tym czasie metrów', () => {
    const r = new TreadmillRunner(workout);
    r.start();
    r.tick({ speed: 6, hr: null, distanceM: 1000 }); // pierwszy odczyt: z prędkości
    r.tick({ speed: 5.5, hr: null, distanceM: 1001.5 });
    expect(r.distance).toBeCloseTo(6 / 3.6 + 1.5);
    r.pause();
    r.start();
    r.tick({ speed: 6, hr: null, distanceM: 1050 });
    expect(r.distance).toBeCloseTo(6 / 3.6 + 1.5 + 6 / 3.6);
  });

  it('odcinek ze strefą tętna zmienia prędkość najwyżej o 1 km/h na minutę', () => {
    // HRmax 200: Z2 = 121–140 bpm
    const w: TreadmillWorkout = { ...workout, intervals: [{ label: 'Z2', duration: 600, speed: 8, hrZone: 1 }] };
    const r = new TreadmillRunner(w, 12, 200);
    expect(r.hrRange()).toEqual({ from: 121, to: 140, id: 'Z2' });
    expect(r.targetSpeed()).toBe(8);
    r.start();
    for (let i = 0; i < 60; i++) r.tick({ speed: 8, hr: 160 });
    expect(r.targetSpeed()).toBe(7.9); // po 60 s czekania pierwszy krok w dół
    for (let i = 0; i < 60; i++) r.tick({ speed: 8, hr: 160 });
    expect(r.targetSpeed()).toBe(6.9); // minuta za wysokiego tętna = −1 km/h
    for (let i = 0; i < 60; i++) r.tick({ speed: 7, hr: 130 });
    expect(r.targetSpeed()).toBe(6.9); // w strefie bez zmian
    for (let i = 0; i < 30; i++) r.tick({ speed: 7, hr: 110 });
    expect(r.targetSpeed()).toBe(7.4); // za niskie: przyspiesza
    for (let i = 0; i < 30; i++) r.tick({ speed: 7, hr: null });
    expect(r.targetSpeed()).toBe(7.4); // bez tętna prędkość stoi
    r.adjust(0.5);
    expect(r.targetSpeed()).toBe(7.9);
  });

  it('strefa tętna przechodzi walidację, niepoprawna nie', () => {
    expect(validateTreadmillWorkout({ name: 'x', intervals: [{ duration: 60, speed: 8, hrZone: 1 }] })).toMatchObject({ workout: { intervals: [{ hrZone: 1 }] } });
    expect(validateTreadmillWorkout({ name: 'x', intervals: [{ duration: 60, speed: 8, hrZone: 7 }] })).toHaveProperty('error');
  });
});
