import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TreadmillWorkout, TreadmillWorkoutInput } from '../shared/treadmill.js';

const ID_RE = /^[0-9a-f]{12}$/;

/** Treningi na bieżnię ułożone w aplikacji: data/treadmill/<id>.json. */
export class TreadmillStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'treadmill');
  }

  async list(): Promise<TreadmillWorkout[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: TreadmillWorkout[] = [];
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      try {
        out.push(JSON.parse(await readFile(path.join(this.dir, f), 'utf8')));
      } catch {
        // pomijamy uszkodzony plik zamiast blokować całą listę
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<TreadmillWorkout | null> {
    if (!ID_RE.test(id)) return null;
    try {
      return JSON.parse(await readFile(path.join(this.dir, `${id}.json`), 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Nowy trening (bez id) albo nadpisanie istniejącego. */
  async save(input: TreadmillWorkoutInput, id?: string): Promise<TreadmillWorkout | null> {
    if (id !== undefined && !(await this.get(id))) return null;
    const workout: TreadmillWorkout = { id: id ?? randomBytes(6).toString('hex'), ...input, updatedAt: new Date().toISOString() };
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${workout.id}.json`);
    await writeFile(`${file}.tmp`, JSON.stringify(workout, null, 2) + '\n', 'utf8');
    await rename(`${file}.tmp`, file);
    return workout;
  }

  async remove(id: string): Promise<boolean> {
    if (!(await this.get(id))) return false;
    await rm(path.join(this.dir, `${id}.json`), { force: true });
    return true;
  }
}
