import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { detectLanIp, startMdns } from './mdns.js';

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

// Opcjonalne ogłaszanie nazwy w sieci lokalnej (MDNS_HOSTNAME=trenazer.local, MDNS_IP=adres NAS).
const mdnsName = process.env.MDNS_HOSTNAME;
if (mdnsName) {
  const ip = process.env.MDNS_IP || detectLanIp();
  if (ip) startMdns(mdnsName, ip, (m) => app.log.info(m));
  else app.log.warn('mDNS: nie znaleziono adresu LAN, ustaw MDNS_IP');
}
