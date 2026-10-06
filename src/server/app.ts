import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { validateProfile } from '../shared/profile.js';
import { ProfileStore } from './storage.js';
import { WorkoutStore } from './workouts.js';
import { ZwoError } from './zwo.js';

export interface AppOptions {
  dataDir: string;
  /** katalog zbudowanego frontendu; pominięty w trybie deweloperskim (Vite serwuje go sam) */
  clientDir?: string;
  logger?: boolean;
}

export function buildApp({ dataDir, clientDir, logger = false }: AppOptions) {
  const app = Fastify({ logger });
  const profiles = new ProfileStore(dataDir);
  const workouts = new WorkoutStore(dataDir);

  app.get('/api/health', async () => ({ ok: true }));

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
