import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { summarize, type Session, type SessionInput, type SessionListItem } from '../shared/session.js';

const ID_RE = /^\d{8}-\d{6}(-\d+)?$/;

/** Historia sesji w data/history: jeden plik JSON na sesję, nazwany datą rozpoczęcia (UTC). */
export class SessionStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'history');
  }

  async list(): Promise<SessionListItem[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: SessionListItem[] = [];
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      try {
        const s: Session = JSON.parse(await readFile(path.join(this.dir, f), 'utf8'));
        out.push({ id: s.id, workoutName: s.workoutName, startedAt: s.startedAt, source: s.source, summary: s.summary });
      } catch {
        // pomijamy uszkodzony plik zamiast blokować całą historię
      }
    }
    return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async get(id: string): Promise<Session | null> {
    if (!ID_RE.test(id)) return null;
    try {
      return JSON.parse(await readFile(path.join(this.dir, `${id}.json`), 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(input: SessionInput): Promise<Session> {
    await mkdir(this.dir, { recursive: true });
    const base = new Date(input.startedAt).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    let id = base;
    for (let i = 2; (await this.get(id)) !== null; i++) id = `${base}-${i}`;
    const session: Session = { id, ...input, summary: summarize(input.samples, input.ftp) };
    const file = path.join(this.dir, `${id}.json`);
    await writeFile(`${file}.tmp`, JSON.stringify(session), 'utf8');
    await rename(`${file}.tmp`, file);
    return session;
  }

  async remove(id: string): Promise<boolean> {
    if (!(await this.get(id))) return false;
    await rm(path.join(this.dir, `${id}.json`), { force: true });
    return true;
  }
}
