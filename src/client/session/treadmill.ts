import { HR_ZONES, zoneRanges } from '../../shared/profile';
import { intervalStarts, TREADMILL_MAX_KPH, TREADMILL_MIN_KPH, type TreadmillWorkout } from '../../shared/treadmill';

const HR_SETTLE_S = 60;
const HR_STEP_S = 6;
const HR_MARGIN = 2;

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
  /** prędkość ustawiana przez regulator strefy tętna i odcinek, którego dotyczy */
  private hrSpeed: number | null = null;
  private hrIndex = -1;
  readonly samples: TreadmillSample[] = [];
  startedAt: Date | null = null;

  constructor(
    readonly workout: TreadmillWorkout,
    /** najwyższa prędkość do ustawienia (limit aplikacji albo bieżni) */
    readonly maxSpeed = TREADMILL_MAX_KPH,
    /** tętno maksymalne z profilu, do stref tętna */
    readonly maxHr = 185,
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

  private clampSpeed(s: number) {
    return Math.round(Math.min(Math.min(TREADMILL_MAX_KPH, this.maxSpeed), Math.max(TREADMILL_MIN_KPH, s)) * 10) / 10;
  }

  /** Prędkość docelowa odcinka z korektą, km/h; w odcinku ze strefą tętna bieżąca prędkość z regulatora. */
  speedOf(i = this.index) {
    if (i === this.index && this.hrSpeed !== null && this.hrIndex === i) return this.clampSpeed(this.hrSpeed);
    return this.clampSpeed(this.workout.intervals[i]!.speed + this.offset);
  }

  /** Zakres tętna (bpm) strefy bieżącego odcinka; null = odcinek ze stałą prędkością. */
  hrRange(i = this.index): { from: number; to: number; id: string } | null {
    const z = this.workout.intervals[i]?.hrZone;
    if (z === null || z === undefined) return null;
    const r = zoneRanges(HR_ZONES, this.maxHr)[z]!;
    return { from: r.from, to: r.to ?? this.maxHr, id: r.id };
  }

  /**
   * Regulator strefy tętna, wołany co sekundę: przez pierwsze HR_SETTLE_S s odcinka czeka, aż tętno
   * zareaguje, potem co HR_STEP_S s zmienia prędkość o 0,1 km/h (1 km/h na minutę), gdy tętno jest
   * przy granicy strefy albo poza nią. Bez odczytu tętna prędkość się nie zmienia.
   */
  private regulate(hr: number | null) {
    const range = this.hrRange();
    if (!range) return;
    if (this.hrIndex !== this.index) {
      this.hrIndex = this.index;
      this.hrSpeed = this.interval.speed + this.offset;
    }
    const t = this.intervalElapsed;
    if (!hr || t < HR_SETTLE_S || t % HR_STEP_S !== 0) return;
    // margines 2 bpm od granic, żeby nie czekać, aż tętno wyjdzie ze strefy
    if (hr > range.to - HR_MARGIN) this.hrSpeed = this.clampSpeed(this.hrSpeed! - 0.1);
    else if (hr < range.from + HR_MARGIN) this.hrSpeed = this.clampSpeed(this.hrSpeed! + 0.1);
  }

  targetSpeed() {
    if (this.hrRange() && this.hrIndex !== this.index) this.regulate(null);
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
    if (!this.finished) this.regulate(r.hr);
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
    // w odcinku ze strefą tętna przyciski zmieniają bieżącą prędkość regulatora
    if (this.hrRange() && this.hrIndex === this.index && this.hrSpeed !== null) {
      this.hrSpeed = this.clampSpeed(this.hrSpeed + delta);
      return;
    }
    this.offset = Math.round(Math.min(3, Math.max(-3, this.offset + delta)) * 10) / 10;
  }
}
