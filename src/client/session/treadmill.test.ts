import { describe, expect, it } from 'vitest';
import type { TreadmillWorkout } from '../../shared/treadmill';
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

  it('liczy kroki z kadencji, a bez kadencji ich nie ma', () => {
    const r = new TreadmillRunner(workout);
    r.start();
    r.tick({ speed: 6, hr: null });
    expect(r.steps).toBeNull();
    r.tick({ speed: 6, hr: null, cadence: 150 });
    r.tick({ speed: 6, hr: null, cadence: 150 });
    expect(r.steps).toBe(5);
    expect(r.toSessionSamples().map((s) => s.cadence)).toEqual([null, 150, 150]);
  });
});
