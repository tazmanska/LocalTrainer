// Pola liczbowe wygodne na ekranie dotykowym: duże przyciski −/+ obok pola, klawiatura numeryczna na telefonie.

const clampTo = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

interface StepperProps {
  value: number;
  onChange: (v: number) => void;
  label: string;
  step: number;
  min: number;
  max: number;
  unit?: string;
  /** liczba miejsc po przecinku (0 = liczby całkowite) */
  digits?: number;
}

/** Liczba z przyciskami −/+ (krok step); wpisana ręcznie wartość jest przycinana do zakresu. */
export function Stepper({ value, onChange, label, step, min, max, unit, digits = 0 }: StepperProps) {
  const round = (v: number) => Math.round(v * 10 ** digits) / 10 ** digits;
  const set = (v: number) => onChange(round(clampTo(v, min, max)));
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => set(value - step)} disabled={value <= min} aria-label={`${label}: mniej`}>
        −
      </button>
      <input
        type="number"
        inputMode={digits ? 'decimal' : 'numeric'}
        min={min}
        max={max}
        step={digits ? 1 / 10 ** digits : 1}
        value={value}
        aria-label={label}
        onChange={(e) => set(Number(e.target.value.replace(',', '.')) || 0)}
      />
      {unit && <span className="u">{unit}</span>}
      <button type="button" onClick={() => set(value + step)} disabled={value >= max} aria-label={`${label}: więcej`}>
        +
      </button>
    </span>
  );
}

/** Czas etapu: minuty i sekundy; −/+ zmienia o 15 s (do 2 min) albo o 1 min. */
export function DurationInput({ value, onChange, label }: { value: number; onChange: (s: number) => void; label: string }) {
  const m = Math.floor(value / 60);
  const s = value % 60;
  const stepDown = value > 120 ? 60 : 15;
  const stepUp = value >= 120 ? 60 : 15;
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(5, value - stepDown))} disabled={value <= 5} aria-label={`${label}: krócej`}>
        −
      </button>
      <input type="number" inputMode="numeric" min={0} max={240} value={m} aria-label={`${label}: minuty`} onChange={(e) => onChange(Math.min(240, num(e.target.value)) * 60 + s)} />
      <span className="u">:</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={59}
        value={String(s).padStart(2, '0')}
        aria-label={`${label}: sekundy`}
        onChange={(e) => onChange(m * 60 + Math.min(59, num(e.target.value)))}
      />
      <button type="button" onClick={() => onChange(Math.min(4 * 3600, value + stepUp))} aria-label={`${label}: dłużej`}>
        +
      </button>
    </span>
  );
}
