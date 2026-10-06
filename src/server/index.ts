import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
const clientDir = path.resolve(process.env.CLIENT_DIR ?? path.join(here, '../../client'));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const app = buildApp({ dataDir, clientDir, logger: true });

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
