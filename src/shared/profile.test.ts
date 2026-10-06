import { describe, expect, it } from 'vitest';
import { HR_ZONES, POWER_ZONES, validateProfile, zoneIndex, zoneRanges } from './profile';

describe('zoneRanges', () => {
  it('liczy strefy mocy Coggana dla FTP 250 W', () => {
    const r = zoneRanges(POWER_ZONES, 250).map((z) => [z.id, z.from, z.to]);
    expect(r).toEqual([
      ['Z1', 0, 138],
      ['Z2', 139, 188],
      ['Z3', 189, 225],
      ['Z4', 226, 263],
      ['Z5', 264, 300],
      ['Z6', 301, 375],
      ['Z7', 376, null],
    ]);
  });

  it('liczy strefy tętna dla HRmax 188', () => {
    const r = zoneRanges(HR_ZONES, 188).map((z) => [z.id, z.from, z.to]);
    expect(r).toEqual([
      ['Z1', 94, 113],
      ['Z2', 114, 132],
      ['Z3', 133, 150],
      ['Z4', 151, 169],
      ['Z5', 170, null],
    ]);
  });

  it('strefy są ciągłe i się nie nakładają', () => {
    for (const ref of [100, 187, 250, 333, 700]) {
      const r = zoneRanges(POWER_ZONES, ref);
      for (let i = 1; i < r.length; i++) expect(r[i]!.from).toBe(r[i - 1]!.to! + 1);
    }
  });
});

describe('zoneIndex', () => {
  it('przypisuje moc do strefy', () => {
    expect(zoneIndex(POWER_ZONES, 250, 100)).toBe(0);
    expect(zoneIndex(POWER_ZONES, 250, 225)).toBe(2);
    expect(zoneIndex(POWER_ZONES, 250, 226)).toBe(3);
    expect(zoneIndex(POWER_ZONES, 250, 900)).toBe(6);
  });
  it('tętno poniżej Z1 to Z1', () => {
    expect(zoneIndex(HR_ZONES, 188, 60)).toBe(0);
  });
});

describe('validateProfile', () => {
  it('przyjmuje poprawny profil i przycina imię', () => {
    const { profile } = validateProfile({ name: ' Tomasz ', ftp: 250, maxHr: 188, weight: 72.25 });
    expect(profile).toEqual({ name: 'Tomasz', ftp: 250, maxHr: 188, weight: 72.3 });
  });
  it('odrzuca wartości spoza zakresu i nie-liczby', () => {
    const { profile, errors } = validateProfile({ ftp: 10, maxHr: 'x', weight: 70 });
    expect(profile).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual(['ftp', 'maxHr']);
  });
  it('wymaga całkowitego FTP', () => {
    expect(validateProfile({ ftp: 250.5, maxHr: 188, weight: 70 }).errors.ftp).toBeDefined();
  });
});
