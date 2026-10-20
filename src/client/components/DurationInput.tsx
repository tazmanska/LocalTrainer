/** Czas etapu jako minuty i sekundy. */
export function DurationInput({ value, onChange, label }: { value: number; onChange: (s: number) => void; label: string }) {
  const m = Math.floor(value / 60);
  const s = value % 60;
  return (
    <span className="tm-dur" aria-label={label}>
      <input type="number" min={0} max={240} value={m} aria-label={`${label}: minuty`} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0) * 60 + s)} />
      <span>min</span>
      <input type="number" min={0} max={59} step={5} value={s} aria-label={`${label}: sekundy`} onChange={(e) => onChange(m * 60 + Math.min(59, Math.max(0, Number(e.target.value) || 0)))} />
      <span>s</span>
    </span>
  );
}
