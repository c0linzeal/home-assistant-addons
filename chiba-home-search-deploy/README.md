# Chiba Home Search — deployment

Two-container stack behind host port **8096**:
- `chiba-home-search` — nginx:alpine, serves the static site and proxies `/api/` to the backend.
- `chiba-home-search-api` — Node backend that scrapes AtHome and returns JSON listings.

## Open
http://<server-LAN-IP>:8096/

## Manage
- Up / rebuild:   `docker compose -f $(pwd)/compose.yaml up -d --build`
- Stop:           `docker compose -f $(pwd)/compose.yaml stop`
- Start:          `docker compose -f $(pwd)/compose.yaml start`
- Restart:        `docker compose -f $(pwd)/compose.yaml restart`
- Logs (API):     `docker logs -f chiba-home-search-api`

## Update after a git pull
- Static frontend changes (chiba-home-search/*) are live immediately (bind mount) — just hard-reload.
- Backend changes (backend/*) need a rebuild:
  `docker compose -f $(pwd)/compose.yaml up -d --build chiba-home-search-api`

## Notes
- Backend listens internally on :3000 (not exposed to the LAN); only nginx on :8096 is public.
- AtHome price/layout/age/walk filters are applied in the backend (they are not GET-addressable on AtHome). The backend scans the first 3 result pages per search and caches results ~10 min.
- Phase 0 covers AtHome + used apartments only.
- Known limitation: AtHome currently bot-gates city-level result pages (returns an 認証中 challenge), so city-filtered live searches report "unavailable" and fall back to the click-out links; the prefecture-wide ("All of Chiba") search works. Full city-level live results would require a headless browser (future work).
