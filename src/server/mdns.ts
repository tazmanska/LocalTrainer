import { networkInterfaces } from 'node:os';
import makeMdns from 'multicast-dns';

/**
 * Ogłaszanie nazwy (np. trenazer.local) w sieci lokalnej przez mDNS, żeby urządzenia bez pliku hosts
 * (Chromebook, Android) mogły otworzyć https://trenazer.local. Wymaga sieci hosta w Dockerze
 * (network_mode: host), bo multicast nie przechodzi przez sieć mostkową.
 */

export interface MdnsQuestion {
  name: string;
  type: string;
}

/** Czy pytanie dotyczy naszej nazwy i typu, na który odpowiadamy (A albo ANY). */
export function isOurQuestion(q: MdnsQuestion, hostname: string): boolean {
  return q.name.toLowerCase() === hostname.toLowerCase() && (q.type === 'A' || q.type === 'ANY');
}

const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

/**
 * Adres LAN tego hosta: pierwszy prywatny IPv4 spoza mostków Dockera.
 * Na NAS lepiej podać MDNS_IP jawnie, bo interfejsów bywa kilka.
 */
export function detectLanIp(ifaces = networkInterfaces()): string | null {
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (/^(docker|br-|veth|lo)/.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal && isPrivate(a.address) && !a.address.startsWith('172.17.')) return a.address;
    }
  }
  return null;
}

export function startMdns(hostname: string, ip: string, log: (msg: string) => void) {
  const mdns = makeMdns({ reuseAddr: true });
  const answer = { name: hostname, type: 'A' as const, ttl: 120, class: 'IN' as const, flush: true, data: ip };

  mdns.on('query', (query) => {
    if (query.questions.some((q) => isOurQuestion(q, hostname))) mdns.respond({ answers: [answer] });
  });
  mdns.on('error', (err) => log(`mDNS: ${err.message}`));
  mdns.on('ready', () => {
    // Ogłoszenie przy starcie, żeby urządzenia z pamięcią podręczną od razu znały adres.
    mdns.respond({ answers: [answer] });
    log(`mDNS: ogłaszam ${hostname} → ${ip}`);
  });
  return mdns;
}
