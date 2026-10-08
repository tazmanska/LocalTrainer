# Trenażer

Aplikacja webowa do treningu na trenażerze smart (BLE) z minimalnym backendem i zapisem do plików JSON.

## Uruchomienie deweloperskie

```bash
npm install
npm run dev        # API na :3000, frontend (Vite) na http://localhost:5173
npm test
```

## Produkcja / Docker (Synology)

```bash
docker compose up -d --build   # http://<nas>:3000
```

Dane trafiają do katalogu podmontowanego jako `/data` (`profile.json`, `workouts/` z oryginałami `.zwo` i sparsowanym JSON, `history/` z zapisanymi sesjami).

## Struktura

- `src/shared` – logika wspólna (profil, walidacja, strefy mocy i tętna)
- `src/server` – Fastify: profil, treningi (import ZWO), historia sesji z eksportem TCX/GPX, serwowanie zbudowanego frontendu
- `src/client` – React + Vite; `devices/` to wymienne źródło danych: symulacja albo Bluetooth (trenażer FTMS / Tacx FE-C z trybem ERG, pas tętna, pedały mocy z balansem L/P; na podstawie GPX Rider, MIT, zob. THIRD_PARTY_NOTICES.md), `session/runner.ts` to przebieg treningu

## Bluetooth

Przełącznik „Symulacja / Bluetooth” jest w zakładce Treningi. Web Bluetooth działa w Chrome i Edge (komputer, Android), nie na iPhonie, i tylko na stronie otwartej przez HTTPS albo pod `localhost`.
