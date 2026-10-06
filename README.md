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
- `src/client` – React + Vite; `devices/` to wymienne źródło danych (na razie symulacja trenażera i pulsometru), `session/runner.ts` to przebieg treningu
