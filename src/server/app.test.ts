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

describe('/api/sessions', () => {
  const samples = Array.from({ length: 120 }, (_, t) => ({ t, power: 200, cadence: 90, hr: 140, target: 200 }));
  const input = {
    workoutId: 'w1',
    workoutName: 'Próg & <test>',
    startedAt: '2026-10-06T05:30:00.000Z',
    ftp: 250,
    maxHr: 188,
    weight: 72,
    source: 'sim',
    segments: [{ kind: 'steady', label: 'Równa jazda', duration: 120, p0: 0.8, p1: 0.8 }],
    samples,
  };

  it('zapisuje sesję z podsumowaniem, listuje bez próbek i usuwa', async () => {
    const app = buildApp({ dataDir });
    const post = await app.inject({ method: 'POST', url: '/api/sessions', payload: input });
    expect(post.statusCode).toBe(201);
    const s = post.json();
    expect(s.id).toBe('20261006-053000');
    expect(s.summary).toMatchObject({ duration: 120, avgPower: 200, np: 200, avgHr: 140, work: 24 });

    const again = await app.inject({ method: 'POST', url: '/api/sessions', payload: input });
    expect(again.json().id).toBe('20261006-053000-2');

    const list = (await app.inject({ method: 'GET', url: '/api/sessions' })).json();
    expect(list).toHaveLength(2);
    expect(list[0].samples).toBeUndefined();

    expect((await app.inject({ method: 'DELETE', url: `/api/sessions/${s.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/sessions/${s.id}` })).statusCode).toBe(404);
  });

  it('odrzuca niepoprawne próbki', async () => {
    const res = await buildApp({ dataDir }).inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { ...input, samples: [{ t: 0, power: 'dużo', cadence: null, hr: null, target: null }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('eksportuje TCX i GPX z mocą, tętnem i kadencją', async () => {
    const app = buildApp({ dataDir });
    const { id } = (await app.inject({ method: 'POST', url: '/api/sessions', payload: input })).json();
    const tcx = await app.inject({ method: 'GET', url: `/api/sessions/${id}/export.tcx` });
    expect(tcx.statusCode).toBe(200);
    expect(tcx.headers['content-disposition']).toContain(`trenazer_${id}.tcx`);
    expect(tcx.body).toContain('<Time>2026-10-06T05:30:00Z</Time>');
    expect(tcx.body).toContain('<ns3:Watts>200</ns3:Watts>');
    expect(tcx.body).toContain('Próg &amp; &lt;test&gt;');
    expect(tcx.body.match(/<Trackpoint>/g)).toHaveLength(120);

    const gpx = await app.inject({ method: 'GET', url: `/api/sessions/${id}/export.gpx` });
    expect(gpx.body).toContain('<gpxtpx:hr>140</gpxtpx:hr>');
    expect(gpx.body).toContain('<power>200</power>');
    expect((await app.inject({ method: 'GET', url: `/api/sessions/${id}/export.fit` })).statusCode).toBe(404);
  });
});

describe('/api/cert', () => {
  it('bez certyfikatu zwraca available=false i 404', async () => {
    const app = buildApp({ dataDir });
    expect((await app.inject({ method: 'GET', url: '/api/cert/info' })).json()).toEqual({ available: false });
    expect((await app.inject({ method: 'GET', url: '/api/cert' })).statusCode).toBe(404);
  });

  it('udostępnia certyfikat z opisem nazw i datą ważności', async () => {
    const pem = await readFile(path.join(__dirname, 'fixtures/test.crt'), 'utf8');
    await writeFile(path.join(dataDir, 'trenazer-ca.crt'), pem);
    const app = buildApp({ dataDir });
    const info = (await app.inject({ method: 'GET', url: '/api/cert/info' })).json();
    expect(info).toMatchObject({ available: true, subject: 'trenazer.local', names: ['trenazer.local', '192.168.0.158'], fileName: 'trenazer-ca.crt' });
    const res = await app.inject({ method: 'GET', url: '/api/cert' });
    expect(res.headers['content-disposition']).toContain('trenazer-ca.crt');
    expect(res.body).toMatch(/^-----BEGIN CERTIFICATE-----/);
  });

  it('nigdy nie wysyła pliku zawierającego klucz prywatny', async () => {
    const pem = await readFile(path.join(__dirname, 'fixtures/test.crt'), 'utf8');
    await writeFile(path.join(dataDir, 'trenazer-ca.crt'), pem + '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n');
    const res = await buildApp({ dataDir }).inject({ method: 'GET', url: '/api/cert' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('PRIVATE');
  });
});

describe('/api/treadmill', () => {
  const body = { name: 'Interwały', intervals: [{ label: 'Bieg', duration: 120, speed: 10 }] };

  it('tworzy, listuje, zmienia i usuwa trening na bieżnię', async () => {
    const app = buildApp({ dataDir });
    const post = await app.inject({ method: 'POST', url: '/api/treadmill', payload: body });
    expect(post.statusCode).toBe(201);
    const w = post.json();
    expect(w).toMatchObject({ name: 'Interwały', intervals: [{ label: 'Bieg', duration: 120, speed: 10, incline: null }] });
    expect(w.id).toMatch(/^[0-9a-f]{12}$/);

    const put = await app.inject({ method: 'PUT', url: `/api/treadmill/${w.id}`, payload: { ...body, name: 'Nowa nazwa' } });
    expect(put.json()).toMatchObject({ id: w.id, name: 'Nowa nazwa' });
    const list = await buildApp({ dataDir }).inject({ method: 'GET', url: '/api/treadmill' });
    expect(list.json()).toHaveLength(1);

    expect((await app.inject({ method: 'DELETE', url: `/api/treadmill/${w.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/treadmill' })).json()).toEqual([]);
  });

  it('odrzuca prędkość powyżej 12 km/h i nieznany trening', async () => {
    const app = buildApp({ dataDir });
    const bad = await app.inject({ method: 'POST', url: '/api/treadmill', payload: { name: 'x', intervals: [{ duration: 60, speed: 14 }] } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/treadmill/000000000000', payload: body })).statusCode).toBe(404);
  });
});

describe('/api/sessions: bieg na bieżni', () => {
  const samples = Array.from({ length: 60 }, (_, t) => ({ t, power: null, cadence: null, hr: 150, target: null, speed: 10, targetSpeed: 10, distance: Math.round(((t + 1) * 10) / 3.6) }));
  const input = {
    workoutId: 'abc',
    workoutName: 'Interwały',
    startedAt: '2026-10-20T06:00:00.000Z',
    ftp: 250,
    maxHr: 188,
    weight: 72,
    source: 'ble',
    sport: 'run',
    segments: [],
    intervals: [{ label: 'Bieg', duration: 60, speed: 10, incline: null }],
    samples,
  };

  it('zapisuje bieg z dystansem, pokazuje go na liście i eksportuje TCX jako bieg', async () => {
    const app = buildApp({ dataDir });
    const post = await app.inject({ method: 'POST', url: '/api/sessions', payload: input });
    expect(post.statusCode).toBe(201);
    const s = post.json();
    expect(s.summary).toMatchObject({ duration: 60, distance: 167, avgSpeed: 10, avgHr: 150 });
    expect((await app.inject({ method: 'GET', url: '/api/sessions' })).json()[0]).toMatchObject({ sport: 'run' });

    const tcx = (await app.inject({ method: 'GET', url: `/api/sessions/${s.id}/export.tcx` })).body;
    expect(tcx).toContain('<Activity Sport="Running">');
    expect(tcx).toContain('<DistanceMeters>167</DistanceMeters>');
    expect(tcx).toContain('<DistanceMeters>3.0</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm><Extensions><ns3:TPX><ns3:Speed>2.78</ns3:Speed>');
    expect(tcx).not.toContain('Watts');
  });

  it('starsze sesje bez pola sport są rowerowe', async () => {
    const app = buildApp({ dataDir });
    const bike = { ...input, sport: undefined, intervals: undefined, samples: samples.map(({ t, hr }) => ({ t, power: 200, cadence: 90, hr, target: 200 })) };
    await app.inject({ method: 'POST', url: '/api/sessions', payload: bike });
    expect((await app.inject({ method: 'GET', url: '/api/sessions' })).json()[0]).toMatchObject({ sport: 'bike' });
  });
});
