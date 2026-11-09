import { describe, expect, it } from 'vitest';
import { balanceLevel, cadenceLevel, cadenceTargetLevel, changeOf, plural } from './format';

describe('progi kolorów', () => {
  it('balans: 50/50 i 51/49 zielony, 52/48 żółty, 53/47 i więcej czerwony', () => {
    expect(balanceLevel(50)).toBe('good');
    expect(balanceLevel(51)).toBe('good');
    expect(balanceLevel(48.6)).toBe('good');
    expect(balanceLevel(52)).toBe('warn');
    expect(balanceLevel(48)).toBe('warn');
    expect(balanceLevel(53)).toBe('bad');
    expect(balanceLevel(42)).toBe('bad');
  });

  it('kadencja: >85 zielony, 81–85 żółty, ≤80 czerwony', () => {
    expect(cadenceLevel(86)).toBe('good');
    expect(cadenceLevel(85)).toBe('warn');
    expect(cadenceLevel(81)).toBe('warn');
    expect(cadenceLevel(80)).toBe('bad');
    expect(cadenceLevel(0)).toBe('bad');
  });

  it('odmiana liczebników', () => {
    expect(plural(1, 'sesja', 'sesje', 'sesji')).toBe('1 sesja');
    expect(plural(3, 'sesja', 'sesje', 'sesji')).toBe('3 sesje');
    expect(plural(12, 'sesja', 'sesje', 'sesji')).toBe('12 sesji');
    expect(plural(22, 'sesja', 'sesje', 'sesji')).toBe('22 sesje');
  });
});

describe('changeOf', () => {
  it('porównuje cel następnego etapu z bieżącym', () => {
    expect(changeOf(200, 250)).toBe('up');
    expect(changeOf(10, 6)).toBe('down');
    expect(changeOf(200, 200)).toBe('same');
    expect(changeOf(null, 200)).toBe('same');
    expect(changeOf(200, null)).toBe('same');
    expect(changeOf(200, undefined)).toBe('same');
  });
});

describe('cadenceTargetLevel', () => {
  it('ocenia odchyłkę od celu w obie strony', () => {
    expect(cadenceTargetLevel(90, 90)).toBe('good');
    expect(cadenceTargetLevel(87, 90)).toBe('good');
    expect(cadenceTargetLevel(93.4, 90)).toBe('good');
    expect(cadenceTargetLevel(86, 90)).toBe('warn');
    expect(cadenceTargetLevel(96, 90)).toBe('warn');
    expect(cadenceTargetLevel(97, 90)).toBe('bad');
    expect(cadenceTargetLevel(80, 90)).toBe('bad');
  });
});
