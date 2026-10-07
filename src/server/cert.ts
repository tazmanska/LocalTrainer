import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface CertInfo {
  available: boolean;
  fileName?: string;
  subject?: string;
  names?: string[];
  validTo?: string;
}

/**
 * Publiczny certyfikat serwera do pobrania z aplikacji, żeby dodać go do zaufanych na Chromebooku czy PC.
 * Zwraca wyłącznie blok CERTIFICATE; plik z kluczem prywatnym nigdy nie zostanie wysłany, nawet przy pomyłce w konfiguracji.
 */
export async function readPublicCert(file: string): Promise<{ pem: string; info: CertInfo } | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  if (/PRIVATE KEY/.test(raw)) return null;
  const match = raw.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  if (!match) return null;
  const pem = match[0] + '\n';
  try {
    const x = new X509Certificate(pem);
    const names = (x.subjectAltName ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^(DNS|IP Address):/, ''))
      .filter(Boolean);
    return {
      pem,
      info: { available: true, subject: x.subject.replace(/^CN=/, ''), names, validTo: new Date(x.validTo).toISOString() },
    };
  } catch {
    return null;
  }
}
