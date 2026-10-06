import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_PROFILE, validateProfile, type Profile } from '../shared/profile.js';

export class ProfileStore {
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'profile.json');
  }

  async read(): Promise<Profile> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_PROFILE };
      throw err;
    }
    const { profile } = validateProfile(JSON.parse(raw));
    // Uszkodzony lub niepełny plik: wracamy do wartości domyślnych zamiast blokować aplikację.
    return profile ?? { ...DEFAULT_PROFILE };
  }

  /** Zapis atomowy: plik tymczasowy + rename, żeby przerwany zapis nie zostawił połowy JSON-a. */
  async write(profile: Profile): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(profile, null, 2) + '\n', 'utf8');
    await rename(tmp, this.file);
  }
}
