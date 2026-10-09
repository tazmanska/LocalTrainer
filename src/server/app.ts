import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readPublicCert, type CertInfo } from './cert.js';
import { validateProfile } from '../shared/profile.js';
import { checkSessionInput, type SessionInput } from '../shared/session.js';
import { toGpx, toTcx } from './export.js';
import { SessionStore } from './sessions.js';
import { ProfileStore } from './storage.js';
import { WorkoutStore } from './workouts.js';
import { ZwoError } from './zwo.js';

export interface AppOptions {
  dataDir: string;
  /** katalog zbudowanego frontendu; pominięty w trybie deweloperskim (Vite serwuje go sam) */
  clientDir?: string;
  logger?: boolean;
  /** publiczny certyfikat HTTPS do pobrania z aplikacji; domyślnie <dataDir>/trenazer-ca.crt (lokalne CA, które podpisuje certyfikat serwera) */
  certFile?: string;
}

export function buildApp({ dataDir, clientDir, logger = false, certFile }: AppOptions) {
  const app = Fastify({ logger });
  const profiles = new ProfileStore(dataDir);
  const workouts = new WorkoutStore(dataDir);
  const sessions = new SessionStore(dataDir);

  app.get('/api/health', async () => ({ ok: true }));

  const certPath = certFile ?? path.join(dataDir, 'trenazer-ca.crt');
  app.get('/api/cert/info', async (): Promise<CertInfo> => {
    const c = await readPublicCert(certPath);
    return c ? { ...c.info, fileName: path.basename(certPath) } : { available: false };
  });
  app.get('/api/cert', async (_req, reply) => {
    const c = await readPublicCert(certPath);
    if (!c) return reply.code(404).send({ error: 'Certyfikat nie jest skonfigurowany' });
    return reply
      .type('application/x-x509-ca-cert')
      .header('Content-Disposition', `attachment; filename="${path.basename(certPath)}"`)
      .send(c.pem);
  });

  app.get('/api/profile', async () => profiles.read());

  app.put('/api/profile', async (req, reply) => {
    const { profile, errors } = validateProfile(req.body);
    if (!profile) return reply.code(400).send({ errors });
    await profiles.write(profile);
    return profile;
  });

  app.get('/api/workouts', async () => workouts.list());

  app.get<{ Params: { id: string } }>('/api/workouts/:id', async (req, reply) => {
    const w = await workouts.get(req.params.id);
    return w ?? reply.code(404).send({ error: 'Nie ma takiego treningu' });
  });

  app.post<{ Body: { fileName?: unknown; content?: unknown } }>('/api/workouts', async (req, reply) => {
    const { fileName, content } = req.body ?? {};
    if (typeof fileName !== 'string' || typeof content !== 'string' || !content.trim()) {
      return reply.code(400).send({ error: 'Oczekiwano pól fileName i content' });
    }
    try {
      return reply.code(201).send(await workouts.import(fileName, content));
    } catch (err) {
      if (err instanceof ZwoError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/workouts/:id', async (req, reply) => {
    const ok = await workouts.remove(req.params.id);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'Nie ma takiego treningu' });
  });

  app.get('/api/sessions', async () => sessions.list());

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const s = await sessions.get(req.params.id);
    return s ?? reply.code(404).send({ error: 'Nie ma takiej sesji' });
  });

  // 3 h przy 1 Hz to ok. 1 MB JSON-a, stąd większy limit niż domyślny
  app.post('/api/sessions', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    const err = checkSessionInput(req.body);
    if (err) return reply.code(400).send({ error: err });
    return reply.code(201).send(await sessions.save(req.body as SessionInput));
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const ok = await sessions.remove(req.params.id);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'Nie ma takiej sesji' });
  });

  app.get<{ Params: { id: string; format: string } }>('/api/sessions/:id/export.:format', async (req, reply) => {
    const { id, format } = req.params;
    if (format !== 'tcx' && format !== 'gpx') return reply.code(404).send({ error: 'Nieznany format' });
    const s = await sessions.get(id);
    if (!s) return reply.code(404).send({ error: 'Nie ma takiej sesji' });
    return reply
      .type(format === 'tcx' ? 'application/vnd.garmin.tcx+xml' : 'application/gpx+xml')
      .header('Content-Disposition', `attachment; filename="trenazer_${id}.${format}"`)
      .send(format === 'tcx' ? toTcx(s) : toGpx(s));
  });

  if (clientDir && existsSync(clientDir)) {
    app.register(fastifyStatic, { root: clientDir });
    // SPA: nieznane ścieżki spoza /api dostają index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
