import { useEffect, useState } from 'react';

interface CertInfo {
  available: boolean;
  fileName?: string;
  subject?: string;
  names?: string[];
  validTo?: string;
}

type Platform = 'chromeos' | 'windows' | 'android' | 'other';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/CrOS/.test(ua)) return 'chromeos';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
}

const STEPS: Record<Exclude<Platform, 'other'>, { title: string; steps: string[] }> = {
  chromeos: {
    title: 'Chromebook',
    steps: [
      'Pobierz certyfikat przyciskiem powyżej (trafi do folderu Pobrane).',
      'Ustawienia → Prywatność i bezpieczeństwo → Bezpieczeństwo → Zarządzaj certyfikatami.',
      'Karta „Urzędy certyfikacji” → Importuj → wybierz pobrany plik .crt.',
      'Zaznacz „Ufaj temu certyfikatowi przy identyfikowaniu stron internetowych” i potwierdź.',
      'Zamknij wszystkie karty aplikacji i otwórz ją ponownie przez https.',
    ],
  },
  windows: {
    title: 'Windows',
    steps: [
      'Pobierz certyfikat przyciskiem powyżej.',
      'Otwórz pobrany plik .crt → Zainstaluj certyfikat → Komputer lokalny.',
      '„Umieść wszystkie certyfikaty w następującym magazynie” → Zaufane główne urzędy certyfikacji.',
      'Zamknij wszystkie okna Chrome lub Edge i otwórz aplikację ponownie przez https.',
    ],
  },
  android: {
    title: 'Android',
    steps: [
      'Pobierz certyfikat przyciskiem powyżej.',
      'Ustawienia → Zabezpieczenia → Szyfrowanie i dane logowania → Zainstaluj certyfikat → Certyfikat CA.',
      'Wybierz pobrany plik .crt i potwierdź.',
      'Otwórz aplikację ponownie w Chrome przez https.',
    ],
  },
};

/** Stan połączenia HTTPS i pobranie certyfikatu serwera, żeby przeglądarka zaufała stronie (wymóg Web Bluetooth). */
export function CertPanel() {
  const [info, setInfo] = useState<CertInfo | null>(null);
  const platform = detectPlatform();

  useEffect(() => {
    fetch('/api/cert/info')
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then(setInfo)
      .catch(() => setInfo({ available: false }));
  }, []);

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const trusted = location.protocol === 'https:' && window.isSecureContext;
  const status = trusted
    ? { cls: 'ok', text: 'Połączenie HTTPS jest zaufane. Bluetooth może działać.' }
    : local
      ? { cls: 'ok', text: 'Aplikacja otwarta pod localhost. Bluetooth działa bez certyfikatu.' }
      : { cls: 'err', text: 'Strona nie jest otwarta przez zaufane HTTPS, więc przeglądarka zablokuje Bluetooth.' };

  const order = (platform === 'other' ? ['chromeos', 'windows', 'android'] : [platform, ...(['chromeos', 'windows', 'android'] as const).filter((p) => p !== platform)]) as (keyof typeof STEPS)[];

  return (
    <section className="panel certpanel">
      <div className="zhead">
        <h3>Certyfikat HTTPS</h3>
        <span className="lbl">wymagany dla Bluetooth</span>
      </div>
      <p className={`small ${status.cls}`}>{status.text}</p>
      {info?.available ? (
        <>
          <div className="certrow">
            <a className="btn primary" href="/api/cert" download={info.fileName}>
              Pobierz certyfikat
            </a>
            <span className="small muted">
              {info.names?.join(', ')} · ważny do {info.validTo ? new Date(info.validTo).toLocaleDateString('pl-PL') : '–'}
            </span>
          </div>
          {order.map((p, i) => (
            <details key={p} open={i === 0 && !trusted}>
              <summary>Jak dodać do zaufanych: {STEPS[p].title}</summary>
              <ol>
                {STEPS[p].steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </details>
          ))}
        </>
      ) : (
        info && <p className="small muted">Serwer nie ma skonfigurowanego certyfikatu (plik trenazer.crt w katalogu danych).</p>
      )}
    </section>
  );
}
