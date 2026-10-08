import type { Sample } from '../../shared/session';
import { segmentStarts, targetAt, type Workout } from '../../shared/workout';
import type { Reading } from '../devices/source';

export const BIAS_MIN = 0.5;
export const BIAS_MAX = 1.5;

/**
 * Przebieg treningu niezależny od UI i źródła danych: zegar treningu, bieżący etap,
 * moc docelowa z korektą intensywności i zapis próbek co sekundę.
 */
export class WorkoutRunner {
  readonly starts: number[];
  readonly total: number;
  elapsed = 0;
  bias = 1;
  running = false;
  readonly samples: Sample[] = [];
  startedAt: Date | null = null;

  constructor(
    readonly workout: Workout,
    readonly ftp: number,
  ) {
    this.starts = segmentStarts(workout.segments);
    this.total = workout.segments.reduce((a, s) => a + s.duration, 0);
  }

  get finished() {
    return this.elapsed >= this.total;
  }

  get segmentIndex() {
    const t = Math.min(this.elapsed, this.total - 1);
    for (let i = this.starts.length - 1; i >= 0; i--) if (t >= this.starts[i]!) return i;
    return 0;
  }

  get segment() {
    return this.workout.segments[this.segmentIndex]!;
  }

  get segmentElapsed() {
    return this.elapsed - this.starts[this.segmentIndex]!;
  }

  get segmentRemaining() {
    return Math.max(0, this.segment.duration - this.segmentElapsed);
  }

  /** Moc docelowa jako ułamek FTP (z korektą intensywności); null = jazda swobodna. */
  targetPct(): number | null {
    const p = targetAt(this.segment, this.segmentElapsed);
    return p === null ? null : p * this.bias;
  }

  targetWatts(): number | null {
    const p = this.targetPct();
    return p === null ? null : Math.round(p * this.ftp);
  }

  start() {
    if (this.finished) return;
    this.running = true;
    this.startedAt ??= new Date();
  }

  pause() {
    this.running = false;
  }

  /** Jedna sekunda treningu: zapisuje próbkę z ostatnimi odczytami i przesuwa zegar. */
  tick(r: Reading) {
    if (!this.running || this.finished) return;
    this.samples.push({
      t: this.elapsed,
      power: r.power ?? null,
      cadence: r.cadence ?? null,
      hr: r.hr ?? null,
      target: this.targetWatts(),
      ...(r.balance != null ? { balance: r.balance } : {}),
    });
    this.elapsed++;
    if (this.finished) this.running = false;
  }

  skipSegment() {
    const i = this.segmentIndex;
    this.elapsed = i + 1 < this.starts.length ? this.starts[i + 1]! : this.total;
    if (this.finished) this.running = false;
  }

  adjustBias(delta: number) {
    this.bias = Math.round(Math.min(BIAS_MAX, Math.max(BIAS_MIN, this.bias + delta)) * 100) / 100;
  }
}
