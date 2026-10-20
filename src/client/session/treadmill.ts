import { intervalStarts, TREADMILL_MAX_KPH, TREADMILL_MIN_KPH, type TreadmillWorkout } from '../../shared/treadmill';

export interface TreadmillSample {
  t: number;
  /** prędkość zmierzona przez bieżnię, km/h */
  speed: number | null;
  /** prędkość docelowa, km/h */
  target: number;
  hr: number | null;
  /** dystans od początku treningu, m */
  distance: number;
}

/**
 * Przebieg treningu na bieżni niezależny od UI i urządzenia: zegar, bieżący odcinek,
 * prędkość docelowa z korektą (±0,5 km/h) ucinana do limitu, dystans i próbki co sekundę.
 */
export class TreadmillRunner {
  readonly starts: number[];
  readonly total: number;
  elapsed = 0;
  /** korekta prędkości dla całego treningu, km/h */
  offset = 0;
  running = false;
  /** dystans liczony z prędkości zmierzonej (albo docelowej, gdy bieżnia jej nie podaje), m */
  distance = 0;
  private lastDistanceM: number | null = null;
  readonly samples: TreadmillSample[] = [];
  startedAt: Date | null = null;

  constructor(
    readonly workout: TreadmillWorkout,
    /** najwyższa prędkość do ustawienia (limit aplikacji albo bieżni) */
    readonly maxSpeed = TREADMILL_MAX_KPH,
  ) {
    this.starts = intervalStarts(workout.intervals);
    this.total = workout.intervals.reduce((a, s) => a + s.duration, 0);
  }

  get finished() {
    return this.elapsed >= this.total;
  }

  get index() {
    const t = Math.min(this.elapsed, this.total - 1);
    for (let i = this.starts.length - 1; i >= 0; i--) if (t >= this.starts[i]!) return i;
    return 0;
  }

  get interval() {
    return this.workout.intervals[this.index]!;
  }

  get intervalElapsed() {
    return this.elapsed - this.starts[this.index]!;
  }

  get intervalRemaining() {
    return Math.max(0, this.interval.duration - this.intervalElapsed);
  }

  /** Prędkość docelowa odcinka z korektą, km/h. */
  speedOf(i = this.index) {
    const s = this.workout.intervals[i]!.speed + this.offset;
    return Math.round(Math.min(Math.min(TREADMILL_MAX_KPH, this.maxSpeed), Math.max(TREADMILL_MIN_KPH, s)) * 10) / 10;
  }

  targetSpeed() {
    return this.speedOf();
  }

  targetIncline(): number | null {
    return this.interval.incline ?? null;
  }

  start() {
    if (this.finished) return;
    this.running = true;
    this.startedAt ??= new Date();
  }

  pause() {
    this.running = false;
    this.lastDistanceM = null;
  }

  /** Jedna sekunda treningu. */
  tick(r: { speed: number | null; hr: number | null; distanceM?: number | null }) {
    if (!this.running || this.finished) return;
    const target = this.targetSpeed();
    // Dystans z licznika bieżni (przyrost od poprzedniej sekundy), a bez niego z prędkości.
    const d = r.distanceM ?? null;
    const step = d !== null && this.lastDistanceM !== null ? d - this.lastDistanceM : null;
    this.distance += step !== null && step >= 0 && step < 10 ? step : (r.speed ?? target) / 3.6;
    this.lastDistanceM = d;
    this.samples.push({ t: this.elapsed, speed: r.speed, target, hr: r.hr, distance: Math.round(this.distance * 10) / 10 });
    this.elapsed++;
    if (this.finished) this.running = false;
  }

  skip() {
    const i = this.index;
    this.elapsed = i + 1 < this.starts.length ? this.starts[i + 1]! : this.total;
    if (this.finished) this.running = false;
  }

  /** Dane do zapisu w historii (format sesji wspólny z rowerem: bez mocy, z prędkością i dystansem). */
  toSessionSamples() {
    return this.samples.map((s) => ({ t: s.t, power: null, cadence: null, hr: s.hr, target: null, speed: s.speed, targetSpeed: s.target, distance: s.distance }));
  }

  adjust(delta: number) {
    this.offset = Math.round(Math.min(3, Math.max(-3, this.offset + delta)) * 10) / 10;
  }
}
