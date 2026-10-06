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

Dane trafiają do katalogu podmontowanego jako `/data` (`profile.json`, `workouts/` z oryginałami `.zwo` i sparsowanym JSON; później historia sesji).

## Struktura

- `src/shared` – logika wspólna (profil, walidacja, strefy mocy i tętna)
- `src/server` – Fastify: `GET/PUT /api/profile`, `GET/POST/DELETE /api/workouts` (import ZWO), serwowanie zbudowanego frontendu
- `src/client` – React + Vite
