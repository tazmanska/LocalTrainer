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

  it('nieczytelny JSON profilu daje błąd 500 zamiast cichych wartości domyślnych', async () => {
    await writeFile(path.join(dataDir, 'profile.json'), '{nie json');
    const res = await buildApp({ dataDir }).inject({ method: 'GET', url: '/api/profile' });
    expect(res.statusCode).toBe(500);
  });
});

describe('/api/workouts', () => {
  const zwo = '<workout_file><name>Próg 2×20</name><workout><SteadyState Duration="1200" Power="1"/></workout></workout_file>';

  it('importuje, listuje, odczytuje i usuwa trening', async () => {
    const app = buildApp({ dataDir });
    const post = await app.inject({ method: 'POST', url: '/api/workouts', payload: { fileName: 'prog.zwo', content: zwo } });
    expect(post.statusCode).toBe(201);
    const w = post.json();
    expect(w.id).toMatch(/^prog-2-20-[0-9a-f]{8}$/);
    expect(await readFile(path.join(dataDir, 'workouts', `${w.id}.zwo`), 'utf8')).toBe(zwo);

    const list = await app.inject({ method: 'GET', url: '/api/workouts' });
    expect(list.json().map((x: { id: string }) => x.id)).toEqual([w.id]);
    expect((await app.inject({ method: 'GET', url: `/api/workouts/${w.id}` })).json().name).toBe('Próg 2×20');

    expect((await app.inject({ method: 'DELETE', url: `/api/workouts/${w.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/workouts/${w.id}` })).statusCode).toBe(404);
  });

  it('ponowny import tego samego pliku nie tworzy duplikatu', async () => {
    const app = buildApp({ dataDir });
    await app.inject({ method: 'POST', url: '/api/workouts', payload: { fileName: 'a.zwo', content: zwo } });
    await app.inject({ method: 'POST', url: '/api/workouts', payload: { fileName: 'a.zwo', content: zwo } });
    expect((await app.inject({ method: 'GET', url: '/api/workouts' })).json()).toHaveLength(1);
  });

  it('zły plik daje 400 z komunikatem', async () => {
    const res = await buildApp({ dataDir }).inject({ method: 'POST', url: '/api/workouts', payload: { fileName: 'x.zwo', content: '<a/>' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/ZWO/);
  });

  it('odrzuca id z próbą wyjścia poza katalog', async () => {
    const res = await buildApp({ dataDir }).inject({ method: 'GET', url: '/api/workouts/..%2Fprofile' });
    expect(res.statusCode).toBe(404);
  });
});
