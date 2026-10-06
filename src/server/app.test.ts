import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '../shared/profile';
import { buildApp } from './app';

let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'trenazer-'));
});
afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('/api/profile', () => {
  it('zwraca domyślny profil, gdy pliku nie ma', async () => {
    const res = await buildApp({ dataDir }).inject({ method: 'GET', url: '/api/profile' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULT_PROFILE);
  });

  it('zapisuje profil do profile.json i odczytuje go ponownie', async () => {
    const app = buildApp({ dataDir });
    const body = { name: 'Tomasz', ftp: 250, maxHr: 188, weight: 72 };
    const put = await app.inject({ method: 'PUT', url: '/api/profile', payload: body });
    expect(put.statusCode).toBe(200);
    expect(JSON.parse(await readFile(path.join(dataDir, 'profile.json'), 'utf8'))).toEqual(body);
    const get = await buildApp({ dataDir }).inject({ method: 'GET', url: '/api/profile' });
    expect(get.json()).toEqual(body);
  });

  it('odrzuca niepoprawne dane kodem 400 i nie nadpisuje pliku', async () => {
    const app = buildApp({ dataDir });
    const res = await app.inject({ method: 'PUT', url: '/api/profile', payload: { ftp: -5 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.ftp).toBeDefined();
    const get = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(get.json()).toEqual(DEFAULT_PROFILE);
  });

  it('nieczytelny JSON daje błąd 500 zamiast cichych wartości domyślnych', async () => {
    await writeFile(path.join(dataDir, 'profile.json'), '{nie json');
    const res = await buildApp({ dataDir }).inject({ method: 'GET', url: '/api/profile' });
    expect(res.statusCode).toBe(500);
  });
});
