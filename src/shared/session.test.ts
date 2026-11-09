import { describe, expect, it } from 'vitest';
import { cadenceOnTarget, summarize, type Sample } from './session';
import type { Segment } from './workout';

const segments: Segment[] = [
  { kind: 'steady', label: 'Luz', duration: 4, p0: 0.5, p1: 0.5 },
  { kind: 'on', label: 'A', duration: 4, p0: 0.7, p1: 0.7, cadence: 90 },
  { kind: 'off', label: 'B', duration: 2, p0: 0.7, p1: 0.7, cadence: 108 },
];
const sample = (t: number, cadence: number | null): Sample => ({ t, power: 150, cadence, hr: null, target: 150 });

describe('cadenceOnTarget', () => {
  it('liczy tylko etapy z celem i każdy etap względem jego celu', () => {
    const cads = [50, 50, 50, 50, 90, 93, 94, 80, 108, 90];
    expect(cadenceOnTarget(cads.map((c, t) => sample(t, c)), segments)).toBe(50); // w celu: 90, 93, 108 z 6 sekund
  });

  it('pomija sekundy bez odczytu, a bez celów zwraca null', () => {
    expect(cadenceOnTarget([sample(4, null), sample(5, 90)], segments)).toBe(100);
    expect(cadenceOnTarget([sample(0, 90)], segments)).toBeNull();
  });

  it('trafia do podsumowania sesji', () => {
    expect(summarize([sample(4, 90)], 200, segments).cadenceOnTarget).toBe(100);
    expect(summarize([sample(4, 90)], 200).cadenceOnTarget).toBeNull();
  });
});
