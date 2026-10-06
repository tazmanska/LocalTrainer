import { XMLParser } from 'fast-xml-parser';
import type { Segment, Workout } from '../shared/workout.js';

export class ZwoError extends Error {}

type Node = Record<string, unknown> & { ':@'?: Record<string, string> };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  parseAttributeValue: false,
  trimValues: true,
});

const tagOf = (n: Node) => Object.keys(n).find((k) => k !== ':@') ?? '';
const childrenOf = (n: Node) => (n[tagOf(n)] as Node[] | undefined) ?? [];
const textOf = (n: Node | undefined) =>
  n ? childrenOf(n).map((c) => (typeof c['#text'] === 'string' || typeof c['#text'] === 'number' ? String(c['#text']) : '')).join('').trim() : '';

/** Atrybuty z nazwami sprowadzonymi do małych liter (pliki z różnych generatorów różnią się wielkością liter). */
function attrsOf(n: Node): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(n[':@'] ?? {})) out[k.toLowerCase()] = String(v);
  return out;
}

function num(a: Record<string, string>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    if (a[k] === undefined) continue;
    const v = Number(a[k]);
    if (!Number.isFinite(v)) throw new ZwoError(`Niepoprawna wartość atrybutu ${k}: "${a[k]}"`);
    return v;
  }
  return undefined;
}

function req(a: Record<string, string>, tag: string, ...keys: string[]): number {
  const v = num(a, ...keys);
  if (v === undefined) throw new ZwoError(`Etap ${tag} nie ma atrybutu ${keys[0]}`);
  return v;
}

function power(v: number, tag: string): number {
  if (v < 0 || v > 5) throw new ZwoError(`Etap ${tag}: moc ${v} poza zakresem (oczekiwany ułamek FTP, np. 0.75)`);
  return v;
}

function duration(a: Record<string, string>, tag: string, ...keys: string[]): number {
  const d = Math.round(req(a, tag, ...keys));
  if (d <= 0) throw new ZwoError(`Etap ${tag}: czas trwania musi być dodatni`);
  return d;
}

function cadence(a: Record<string, string>, ...keys: string[]): { cadence?: number } {
  const c = num(a, ...keys);
  return c && c > 0 ? { cadence: Math.round(c) } : {};
}

function parseSegments(nodes: Node[]): Segment[] {
  const out: Segment[] = [];
  for (const n of nodes) {
    const tag = tagOf(n);
    if (tag === '#text' || tag === '#comment') continue;
    const a = attrsOf(n);
    switch (tag.toLowerCase()) {
      case 'warmup':
      case 'ramp':
      case 'cooldown': {
        const kind = tag.toLowerCase() as 'warmup' | 'ramp' | 'cooldown';
        let p0 = power(req(a, tag, 'powerlow'), tag);
        let p1 = power(req(a, tag, 'powerhigh'), tag);
        // Generatory różnie zapisują schłodzenie; zawsze ma opadać.
        if (kind === 'cooldown' && p0 < p1) [p0, p1] = [p1, p0];
        const label = { warmup: 'Rozgrzewka', ramp: 'Rampa', cooldown: 'Schłodzenie' }[kind];
        out.push({ kind, label, duration: duration(a, tag, 'duration'), p0, p1, ...cadence(a, 'cadence') });
        break;
      }
      case 'steadystate': {
        const p = num(a, 'power') ?? num(a, 'powerlow');
        if (p === undefined) throw new ZwoError(`Etap ${tag} nie ma atrybutu Power`);
        const pw = power(p, tag);
        out.push({ kind: 'steady', label: 'Równa jazda', duration: duration(a, tag, 'duration'), p0: pw, p1: pw, ...cadence(a, 'cadence') });
        break;
      }
      case 'intervalst': {
        const repeat = Math.max(1, Math.round(num(a, 'repeat') ?? 1));
        const onD = duration(a, tag, 'onduration');
        const offD = duration(a, tag, 'offduration');
        const on0 = power(num(a, 'onpower', 'poweronlow') ?? req(a, tag, 'onpower'), tag);
        const on1 = power(num(a, 'onpower', 'poweronhigh') ?? on0, tag);
        const off0 = power(num(a, 'offpower', 'powerofflow') ?? req(a, tag, 'offpower'), tag);
        const off1 = power(num(a, 'offpower', 'poweroffhigh') ?? off0, tag);
        const cOn = cadence(a, 'cadence');
        const cOff = cadence(a, 'cadenceresting');
        for (let i = 1; i <= repeat; i++) {
          out.push({ kind: 'on', label: `Interwał ${i}/${repeat}`, duration: onD, p0: on0, p1: on1, ...cOn });
          out.push({ kind: 'off', label: `Przerwa ${i}/${repeat}`, duration: offD, p0: off0, p1: off1, ...cOff });
        }
        break;
      }
      case 'freeride':
      case 'maxeffort': {
        const label = tag.toLowerCase() === 'freeride' ? 'Jazda swobodna' : 'Maksymalny wysiłek';
        out.push({ kind: 'free', label, duration: duration(a, tag, 'duration'), p0: null, p1: null, ...cadence(a, 'cadence') });
        break;
      }
      case 'textevent':
      case 'textnotification':
        break;
      default:
        throw new ZwoError(`Nieobsługiwany typ etapu: ${tag}`);
    }
  }
  return out;
}

export type ParsedWorkout = Omit<Workout, 'id' | 'importedAt'>;

export function parseZwo(xml: string, fileName: string): ParsedWorkout {
  let doc: Node[];
  try {
    doc = parser.parse(xml) as Node[];
  } catch (err) {
    throw new ZwoError(`Plik nie jest poprawnym XML: ${(err as Error).message}`);
  }
  const root = doc.find((n) => tagOf(n).toLowerCase() === 'workout_file');
  if (!root) throw new ZwoError('To nie jest plik treningu ZWO (brak elementu workout_file)');

  const kids = childrenOf(root);
  const find = (name: string) => kids.find((n) => tagOf(n).toLowerCase() === name);
  const sport = textOf(find('sporttype')).toLowerCase();
  if (sport && sport !== 'bike') throw new ZwoError(`Trening dla innego sportu (${sport}), obsługiwany jest tylko rower`);

  const workoutNode = find('workout');
  if (!workoutNode) throw new ZwoError('Plik nie zawiera elementu workout');
  const segments = parseSegments(childrenOf(workoutNode));
  if (!segments.length) throw new ZwoError('Trening nie ma żadnych etapów');

  const baseName = fileName.replace(/\.zwo$/i, '');
  return {
    name: textOf(find('name')) || baseName,
    author: textOf(find('author')),
    description: textOf(find('description')),
    fileName,
    segments,
  };
}
