import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { workoutStats } from '../shared/workout';
import { parseZwo, ZwoError } from './zwo';

const fixture = readFileSync(path.join(__dirname, 'fixtures/sweet_spot_3x10.zwo'), 'utf8');

describe('parseZwo', () => {
  const w = parseZwo(fixture, 'sweet_spot_3x10.zwo');

  it('czyta metadane', () => {
    expect(w).toMatchObject({ name: 'Sweet Spot 3x10', author: 'MyWoosh', fileName: 'sweet_spot_3x10.zwo' });
    expect(w.description).toContain('90% FTP');
  });

  it('rozwija interwały i zachowuje kolejność etapów', () => {
    expect(w.segments.map((s) => s.label)).toEqual([
      'Rozgrzewka',
      'Interwał 1/3', 'Przerwa 1/3',
      'Interwał 2/3', 'Przerwa 2/3',
      'Interwał 3/3', 'Przerwa 3/3',
      'Równa jazda',
      'Jazda swobodna',
      'Schłodzenie',
    ]);
    expect(w.segments[1]).toEqual({ kind: 'on', label: 'Interwał 1/3', duration: 600, p0: 0.9, p1: 0.9, cadence: 90 });
    expect(w.segments[8]).toMatchObject({ kind: 'free', p0: null, p1: null });
  });

  it('schłodzenie zawsze opada', () => {
    expect(w.segments.at(-1)).toMatchObject({ p0: 0.6, p1: 0.4 });
  });

  it('nazwa z pliku, gdy brak elementu name; atrybuty bez względu na wielkość liter', () => {
    const x = parseZwo('<workout_file><workout><steadystate duration="300" power="0.7"/></workout></workout_file>', 'moj.zwo');
    expect(x.name).toBe('moj');
    expect(x.segments[0]).toMatchObject({ duration: 300, p0: 0.7 });
  });

  it('odrzuca błędne pliki czytelnym komunikatem', () => {
    expect(() => parseZwo('<html></html>', 'a.zwo')).toThrow(/workout_file/);
    expect(() => parseZwo('<workout_file><sportType>run</sportType><workout><SteadyState Duration="60" Power="0.7"/></workout></workout_file>', 'a.zwo')).toThrow(ZwoError);
    expect(() => parseZwo('<workout_file><workout><SteadyState Duration="60"/></workout></workout_file>', 'a.zwo')).toThrow(/Power/);
    expect(() => parseZwo('<workout_file><workout><SteadyState Duration="60" Power="250"/></workout></workout_file>', 'a.zwo')).toThrow(/zakresem/);
    expect(() => parseZwo('<workout_file><workout><Foo Duration="60"/></workout></workout_file>', 'a.zwo')).toThrow(/Foo/);
    expect(() => parseZwo('<workout_file><workout></workout></workout_file>', 'a.zwo')).toThrow(/etapów/);
  });
});

describe('workoutStats', () => {
  it('stała moc: IF = moc, TSS = godziny × IF² × 100', () => {
    const s = workoutStats([{ kind: 'steady', label: '', duration: 3600, p0: 1, p1: 1 }]);
    expect(s.duration).toBe(3600);
    expect(s.intensity).toBeCloseTo(1, 5);
    expect(s.tss).toBeCloseTo(100, 3);
  });

  it('interwały podnoszą NP ponad średnią', () => {
    const w = parseZwo(fixture, 'a.zwo');
    const s = workoutStats(w.segments);
    expect(s.duration).toBe(600 + 3 * 840 + 120 + 60 + 480);
    expect(s.intensity).toBeGreaterThan(s.avg);
    expect(s.max).toBeCloseTo(0.9, 5);
  });
});
