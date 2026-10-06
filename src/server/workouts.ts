import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Workout } from '../shared/workout.js';
import { parseZwo } from './zwo.js';

const ID_RE = /^[a-z0-9-]{1,80}$/;

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'trening';

/** Treningi w data/workouts: <id>.json (sparsowany) obok <id>.zwo (oryginał). */
export class WorkoutStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'workouts');
  }

  async list(): Promise<Workout[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: Workout[] = [];
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      try {
        out.push(JSON.parse(await readFile(path.join(this.dir, f), 'utf8')));
      } catch {
        // pomijamy uszkodzony plik zamiast blokować całą bibliotekę
      }
    }
    return out.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }

  async get(id: string): Promise<Workout | null> {
    if (!ID_RE.test(id)) return null;
    try {
      return JSON.parse(await readFile(path.join(this.dir, `${id}.json`), 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Ten sam plik wczytany ponownie dostaje to samo id i nadpisuje poprzednią wersję. */
  async import(fileName: string, content: string): Promise<Workout> {
    const parsed = parseZwo(content, path.basename(fileName));
    const hash = createHash('sha1').update(content).digest('hex').slice(0, 8);
    const workout: Workout = { id: `${slug(parsed.name)}-${hash}`, importedAt: new Date().toISOString(), ...parsed };
    await mkdir(this.dir, { recursive: true });
    await this.atomicWrite(`${workout.id}.zwo`, content);
    await this.atomicWrite(`${workout.id}.json`, JSON.stringify(workout, null, 2) + '\n');
    return workout;
  }

  async remove(id: string): Promise<boolean> {
    if (!(await this.get(id))) return false;
    await rm(path.join(this.dir, `${id}.json`), { force: true });
    await rm(path.join(this.dir, `${id}.zwo`), { force: true });
    return true;
  }

  private async atomicWrite(name: string, data: string) {
    const file = path.join(this.dir, name);
    await writeFile(`${file}.tmp`, data, 'utf8');
    await rename(`${file}.tmp`, file);
  }
}
