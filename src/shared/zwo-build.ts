// Zapis treningu do pliku ZWO (format MyWoosh/Zwift), żeby treningi ułożone w edytorze trafiały do biblioteki tak samo jak wczytane pliki.
import type { Segment } from './workout.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const p = (v: number) => String(Math.round(v * 1000) / 1000);

export interface ZwoInput {
  name: string;
  author?: string;
  description?: string;
  segments: readonly Segment[];
}

/**
 * Każdy etap jest osobnym elementem; nazwa etapu idzie w atrybucie label (inne aplikacje go pomijają,
 * nasz parser go odczytuje), więc po ponownym wczytaniu etapy mają te same nazwy.
 */
export function buildZwo({ name, author = '', description = '', segments }: ZwoInput): string {
  const rows = segments.map((s) => {
    const common = `Duration="${Math.round(s.duration)}"${s.cadence ? ` Cadence="${s.cadence}"` : ''} label="${esc(s.label)}"`;
    if (s.p0 === null || s.p1 === null) return `    <FreeRide ${common}/>`;
    if (s.kind === 'warmup' || s.kind === 'cooldown' || s.p0 !== s.p1) {
      const tag = s.kind === 'warmup' ? 'Warmup' : s.kind === 'cooldown' ? 'Cooldown' : 'Ramp';
      return `    <${tag} ${common} PowerLow="${p(s.p0)}" PowerHigh="${p(s.p1)}"/>`;
    }
    return `    <SteadyState ${common} Power="${p(s.p0)}"/>`;
  });
  return [
    '<workout_file>',
    `  <author>${esc(author)}</author>`,
    `  <name>${esc(name)}</name>`,
    `  <description>${esc(description)}</description>`,
    '  <sportType>bike</sportType>',
    '  <workout>',
    ...rows,
    '  </workout>',
    '</workout_file>',
    '',
  ].join('\n');
}
