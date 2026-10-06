// Profil użytkownika i strefy treningowe. Kod współdzielony przez serwer i przeglądarkę.

export interface Profile {
  name: string;
  /** Moc progowa, W */
  ftp: number;
  /** Tętno maksymalne, bpm */
  maxHr: number;
  /** Masa ciała, kg */
  weight: number;
}

export const DEFAULT_PROFILE: Profile = { name: '', ftp: 200, maxHr: 185, weight: 75 };

export const LIMITS = {
  ftp: { min: 50, max: 700 },
  maxHr: { min: 100, max: 240 },
  weight: { min: 30, max: 200 },
  nameLength: 60,
} as const;

export type ValidationErrors = Partial<Record<keyof Profile, string>>;

export function validateProfile(input: unknown): { profile?: Profile; errors: ValidationErrors } {
  const errors: ValidationErrors = {};
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (name.length > LIMITS.nameLength) errors.name = `Maksymalnie ${LIMITS.nameLength} znaków`;

  const num = (key: 'ftp' | 'maxHr' | 'weight', label: string, integer: boolean) => {
    const v = o[key];
    const { min, max } = LIMITS[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors[key] = `${label}: podaj liczbę`;
      return 0;
    }
    if (integer && !Number.isInteger(v)) errors[key] = `${label}: podaj liczbę całkowitą`;
    else if (v < min || v > max) errors[key] = `${label}: zakres ${min}–${max}`;
    return v;
  };

  const ftp = num('ftp', 'FTP', true);
  const maxHr = num('maxHr', 'Tętno maksymalne', true);
  const weight = num('weight', 'Masa ciała', false);

  if (Object.keys(errors).length) return { errors };
  return { profile: { name, ftp, maxHr, weight: Math.round(weight * 10) / 10 }, errors };
}

export interface ZoneDef {
  id: string;
  name: string;
  /** dolna granica jako ułamek FTP lub HRmax, do wyświetlania (Z1 wyznacza też dolną granicę bezwzględną) */
  lo: number;
  /** górna granica jako ułamek (włącznie); null = bez górnej granicy */
  hi: number | null;
}

/** 7 stref mocy wg Coggana, % FTP */
export const POWER_ZONES: readonly ZoneDef[] = [
  { id: 'Z1', name: 'Regeneracja', lo: 0, hi: 0.55 },
  { id: 'Z2', name: 'Wytrzymałość', lo: 0.56, hi: 0.75 },
  { id: 'Z3', name: 'Tempo', lo: 0.76, hi: 0.9 },
  { id: 'Z4', name: 'Próg', lo: 0.91, hi: 1.05 },
  { id: 'Z5', name: 'VO2max', lo: 1.06, hi: 1.2 },
  { id: 'Z6', name: 'Beztlenowa', lo: 1.21, hi: 1.5 },
  { id: 'Z7', name: 'Neuromięśniowa', lo: 1.51, hi: null },
];

/** 5 stref tętna, % HRmax */
export const HR_ZONES: readonly ZoneDef[] = [
  { id: 'Z1', name: 'Regeneracja', lo: 0.5, hi: 0.6 },
  { id: 'Z2', name: 'Wytrzymałość tlenowa', lo: 0.6, hi: 0.7 },
  { id: 'Z3', name: 'Tempo', lo: 0.7, hi: 0.8 },
  { id: 'Z4', name: 'Próg', lo: 0.8, hi: 0.9 },
  { id: 'Z5', name: 'Maksymalna', lo: 0.9, hi: null },
];

export interface ZoneRange extends ZoneDef {
  /** dolna granica w W lub bpm (włącznie) */
  from: number;
  /** górna granica w W lub bpm (włącznie); null = bez górnej granicy */
  to: number | null;
}

/** Przelicza strefy na wartości bezwzględne; każda strefa zaczyna się 1 W/bpm za końcem poprzedniej. */
export function zoneRanges(zones: readonly ZoneDef[], reference: number): ZoneRange[] {
  let prevTo: number | null = null;
  return zones.map((z) => {
    const from: number = prevTo === null ? Math.round(z.lo * reference) : prevTo + 1;
    const to = z.hi === null ? null : Math.round(z.hi * reference);
    prevTo = to;
    return { ...z, from, to };
  });
}

/** Indeks strefy dla wartości bezwzględnej (W lub bpm). Wartości poniżej Z1 trafiają do Z1. */
export function zoneIndex(zones: readonly ZoneDef[], reference: number, value: number): number {
  const ranges = zoneRanges(zones, reference);
  const rounded = Math.round(value);
  for (let i = ranges.length - 1; i >= 0; i--) {
    if (rounded >= ranges[i]!.from) return i;
  }
  return 0;
}
