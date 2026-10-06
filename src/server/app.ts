import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { validateProfile } from '../shared/profile.js';
import { ProfileStore } from './storage.js';

export interface AppOptions {
  dataDir: string;
  /** katalog zbudowanego frontendu; pominięty w trybie deweloperskim (Vite serwuje go sam) */
  clientDir?: string;
  logger?: boolean;
}

export function buildApp({ dataDir, clientDir, logger = false }: AppOptions) {
  const app = Fastify({ logger });
  const profiles = new ProfileStore(dataDir);

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/profile', async () => profiles.read());

  app.put('/api/profile', async (req, reply) => {
    const { profile, errors } = validateProfile(req.body);
    if (!profile) return reply.code(400).send({ errors });
    await profiles.write(profile);
    return profile;
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
