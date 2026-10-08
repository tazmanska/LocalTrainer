import { describe, expect, it } from 'vitest';
import type { Workout } from '../../shared/workout';
import { summarize } from '../../shared/session';
import { SimulatedSource } from '../devices/simulated';
import { WorkoutRunner } from './runner';

const workout: Workout = {
  id: 'w',
  name: 'Test',
  author: '',
  description: '',
  fileName: 'w.zwo',
  importedAt: '',
  segments: [
    { kind: 'warmup', label: 'Rozgrzewka', duration: 60, p0: 0.5, p1: 0.7 },
    { kind: 'steady', label: 'Równa jazda', duration: 120, p0: 1, p1: 1 },
    { kind: 'free', label: 'Jazda swobodna', duration: 30, p0: null, p1: null },
  ],
};

describe('WorkoutRunner', () => {
  it('nie liczy czasu przed startem i w pauzie', () => {
    const r = new WorkoutRunner(workout, 250);
    r.tick({ power: 100 });
    expect(r.elapsed).toBe(0);
    r.start();
    r.tick({ power: 100 });
    r.pause();
    r.tick({ power: 100 });
    expect(r.elapsed).toBe(1);
    expect(r.samples).toHaveLength(1);
  });

  it('liczy moc docelową na rampie, z korektą intensywności, i null w jeździe swobodnej', () => {
    const r = new WorkoutRunner(workout, 200);
    expect(r.targetWatts()).toBe(100);
    r.elapsed = 30;
    expect(r.targetWatts()).toBe(120);
    r.elapsed = 100;
    r.adjustBias(0.05);
    expect(r.targetWatts()).toBe(210);
    r.elapsed = 190;
    expect(r.targetWatts()).toBeNull();
  });

  it('pomija etap i kończy trening', () => {
    const r = new WorkoutRunner(workout, 200);
    r.start();
    r.skipSegment();
    expect(r.elapsed).toBe(60);
    expect(r.segment.label).toBe('Równa jazda');
    r.skipSegment();
    r.skipSegment();
    expect(r.finished).toBe(true);
    expect(r.running).toBe(false);
  });

  it('zapisuje balans i liczy średni balans ważony mocą', () => {
    const r = new WorkoutRunner(workout, 200);
    r.start();
    r.tick({ power: 300, balance: 52 });
    r.tick({ power: 100, balance: 44 });
    r.tick({ power: 200 });
    expect(r.samples.map((s) => s.balance)).toEqual([52, 44, undefined]);
    expect(summarize(r.samples, 200).avgBalance).toBe(50);
  });

  it('ogranicza intensywność do 50–150%', () => {
    const r = new WorkoutRunner(workout, 200);
    for (let i = 0; i < 20; i++) r.adjustBias(0.05);
    expect(r.bias).toBe(1.5);
    for (let i = 0; i < 40; i++) r.adjustBias(-0.05);
    expect(r.bias).toBe(0.5);
  });

  it('pełny trening z symulacją daje sensowne podsumowanie', () => {
    const sim = new SimulatedSource({ ftp: 250, maxHr: 188, seed: 1 });
    const r = new WorkoutRunner(workout, 250);
    r.start();
    while (!r.finished) {
      sim.setTargetPower(r.targetWatts());
      r.tick(sim.step());
    }
    expect(r.samples).toHaveLength(210);
    const s = summarize(r.samples, 250);
    expect(s.duration).toBe(210);
    expect(s.avgPower).toBeGreaterThan(150);
    expect(s.avgPower).toBeLessThan(250);
    expect(s.avgHr).toBeGreaterThan(90);
    expect(s.maxHr).toBeLessThanOrEqual(188);
  });
});
