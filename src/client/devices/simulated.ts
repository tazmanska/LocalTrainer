import type { DataSource, DeviceInfo, Reading } from './source';

/** Generator pseudolosowy z ziarnem, żeby symulacja była powtarzalna w testach. */
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimOptions {
  ftp: number;
  maxHr: number;
  seed?: number;
  /** odstęp między odczytami, ms */
  intervalMs?: number;
}

/**
 * Symulowany trenażer z pulsometrem: moc dąży do celu ERG z szumem, kadencja rośnie z intensywnością,
 * tętno reaguje z opóźnieniem (model pierwszego rzędu).
 */
export class SimulatedSource implements DataSource {
  readonly id = 'sim' as const;
  private target: number | null = null;
  private power = 0;
  private cadence = 0;
  private hr: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(r: Reading) => void>();
  private readonly rand: () => number;

  constructor(private readonly opts: SimOptions) {
    this.rand = rng(opts.seed ?? Date.now());
    this.hr = Math.round(opts.maxHr * 0.45);
  }

  devices(): DeviceInfo[] {
    const on = this.timer !== null;
    return [
      { label: 'Symulowany trenażer', kind: 'trainer', connected: on, state: on ? 'connected' : 'idle' },
      { label: 'Symulowany pas HR', kind: 'hr', connected: on, state: on ? 'connected' : 'idle' },
    ];
  }

  async connect() {
    if (this.timer) return;
    this.timer = setInterval(() => this.emit(this.step()), this.opts.intervalMs ?? 1000);
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setTargetPower(watts: number | null) {
    this.target = watts;
  }

  onReading(cb: (r: Reading) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  onChange(): () => void {
    // stan symulacji zmienia się tylko przez connect/disconnect wywoływane przez ekran treningu
    return () => {};
  }

  /** Jeden krok symulacji (publiczny na potrzeby testów). */
  step(): Required<Reading> {
    const { ftp, maxHr } = this.opts;
    const r = this.rand;
    // bez celu ERG kolarz jedzie spokojnie, ok. 60% FTP
    const goal = this.target ?? ftp * 0.6;
    this.power = Math.max(0, this.power + (goal - this.power) * 0.45 + (r() - 0.5) * 0.06 * goal);
    const intensity = this.power / ftp;
    const cadGoal = 82 + Math.min(1.3, intensity) * 10;
    this.cadence = Math.max(0, this.cadence + (cadGoal - this.cadence) * 0.35 + (r() - 0.5) * 4);
    const hrGoal = maxHr * (0.5 + 0.45 * Math.min(1, Math.max(0, (intensity - 0.35) / 0.9)));
    this.hr = this.hr + (hrGoal - this.hr) * 0.04 + (r() - 0.5) * 1.2;
    return { power: Math.round(this.power), cadence: Math.round(this.cadence), hr: Math.round(this.hr) };
  }

  private emit(r: Reading) {
    for (const cb of this.listeners) cb(r);
  }
}
