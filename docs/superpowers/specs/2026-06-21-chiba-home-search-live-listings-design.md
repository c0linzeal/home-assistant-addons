# Chiba Home Search — Live Listings Design

- **Date:** 2026-06-21
- **Status:** Approved (design); implementation pending
- **Component:** `chiba-home-search/` static tool + new backend service

## Context

`chiba-home-search/` is a self-contained static tool (vanilla HTML/CSS/JS, no build step, served by nginx on the homelab at port 8096). Today it does **not** search anything: the user sets criteria in English (property type, Chiba city, layout, walk-to-station, building age, budget with USD/JPY conversion), and the tool **generates ready-to-click search links** for four Japanese portals plus a Google `site:` query, translating the filters into Japanese. The user clicks out to each portal to see listings. `data.js` holds reference tables (24 Chiba cities, property types, layouts, walk times, building ages, a 23-term glossary) and per-portal base URLs; `app.js` (~182 lines) does client-side form handling and URL generation. There are zero network calls today.

## Goal

When the user searches, show **real, current listings inside the app** (price, layout, area, building age, walk time, thumbnail, link to the portal), pulled live from the portals — not just outbound links.

## Key constraint and how we resolve it

The portals expose no open API, and a static site cannot fetch them from the browser (CORS; they also block iframing). Genuinely showing live listings therefore requires contacting the portals **server-side**. We add a small backend service for this.

## Feasibility spike (2026-06-21)

A throwaway spike fetched each portal's Chiba "used apartment" results page from the server with a realistic User-Agent. Findings:

| Portal | HTTP | Anti-bot | Listings in raw HTML | Verdict |
|---|---|---|---|---|
| AtHome (`/mansion/chuko/chiba/list/`) | 200 | none | yes — full results page (271 listings, all fields) | **Best first build** |
| SUUMO (`/ms/chuko/chiba/`) | 200 | none | yes (area landing page; deeper paginated list URLs hold full inventory) | HTTP-parse OK |
| HOME'S (`/mansion/chuko/chiba/`) | 200 | none | yes (landing page with featured listings) | HTTP-parse OK |
| HouseDo (`/used_mansion_chiba/`) | 200 | none | server-rendered, but this URL is a city-picker; real list at post-selection URL | HTTP-parse OK, URL mapping needed |

**Conclusion:** all four return server-rendered HTML with no anti-bot challenge and none are JS-only SPAs, so **a lightweight HTTP-fetch-and-parse backend is sufficient — no headless browser needed.** Caveat: a single snapshot can't reveal rate-limit/volume blocking, so the scraper must throttle and re-test under load.

## Architecture

Extend the existing Docker Compose stack from one container to two, behind the **same port 8096**:

```
Browser ──> nginx (8096) ──┬─ /            static site (index.html, app.js, data.js, styles.css)
                           └─ /api/search  reverse-proxy ─> backend container
                                                              │ map filters -> portal URL
                                                              │ fetch portal HTML (server-side)
                                                              │ parse -> normalize listings
                                                              └─ return JSON
```

nginx reverse-proxies `/api/` to the backend, so the frontend calls a **same-origin** API (no CORS, no second exposed port). Portals are contacted only server-side by the backend.

## Backend

- **Stack:** Node + Express + cheerio. Tiny `node:alpine` image; keeps the whole project in one language.
- **One isolated adapter per portal** (`adapters/athome.js`, `suumo.js`, `homes.js`, `housedo.js`). Each adapter: (1) maps the English filter set to that portal's URL/query params, (2) fetches the page, (3) parses listings into a uniform shape. Adapters are independent so one breaking never affects the others.
- **Uniform listing shape:**
  ```
  {
    source: "athome" | "suumo" | "homes" | "housedo",
    title: string,
    price: { yen: number, raw: string },   // raw e.g. "2,980万円"
    layout: string,                        // e.g. "2LDK"
    areaSqm: number | null,
    buildingAge: string | null,            // raw e.g. "築12年"
    walkMin: number | null,
    station: string | null,
    address: string | null,
    thumbnail: string | null,              // absolute URL
    url: string                            // absolute link to the listing on the portal
  }
  ```
- **API:** `GET /api/search` taking the same filters the form already collects (propertyType, city, layout, walkTime, buildingAge, budgetMinYen, budgetMaxYen). Returns `{ portals: [{ source, status, count, listings }], ... }` so partial results and per-portal status are first-class.
- **Resilience:** each adapter is wrapped independently (try/catch + timeout). A failed/slow portal yields a `status: "unavailable"` entry; the others still return. The existing click-out links remain a permanent fallback in the UI.
- **Politeness & caching:** realistic User-Agent + `Accept-Language: ja`, ~12s per-portal timeout, a concurrency limit across portals, and a short in-memory cache (~10 min TTL keyed by normalized search params) so repeat/identical searches don't re-hit the portals.

## Frontend changes (minimal)

On "Build my searches", in addition to today's link cards, call `/api/search?…` and render the returned listings inline as cards (photo, price, layout, location, building age, walk time, source badge, "View on <portal>" link). Results render per portal as each returns. The entire existing link-builder UI is preserved as fallback. No framework, no build step — extend `app.js` with a `fetch` call and a render function.

## Build phases (each independently shippable)

- **Phase 0 — AtHome end-to-end.** Backend skeleton + Dockerfile + compose service + nginx `/api` proxy + AtHome adapter + frontend rendering. Proves the full pipeline; already useful on its own.
- **Phase 1 — SUUMO + HOME'S adapters** (point at their deeper paginated list URLs).
- **Phase 2 — HouseDo adapter** (map the post-city-selection list URL).

## Testing

- Each adapter has unit tests against a **saved HTML fixture** (a real snapshot of that portal's results page committed to the repo), so parsing tests run offline/instantly and immediately flag when a portal changes its markup. One optional live smoke test per portal, opt-in (not in the default test run, so the suite never depends on the network or portal availability).

## Deployment / ops

- The backend joins the existing compose stack (`restart: unless-stopped`, survives reboot), still behind port 8096.
- Update flow: static frontend edits remain live on `git pull`; **backend code changes require `docker compose restart`** (rebuild only if Node dependencies change). Exact commands to be included with the implementation.

## Out of scope (YAGNI for now)

- Pagination beyond the first results page (~20–30 listings/portal).
- Persisting listings (no database; fetched fresh each search).
- Saved searches, alerts, user accounts.

## Risks / open questions

- Portals may rate-limit or block under repeated load; throttling + caching mitigate, but real-world behavior must be watched after launch.
- Portal HTML can change without notice and break an adapter; fixture-based unit tests are the early-warning system, and isolation keeps breakage contained to one portal.
- Scraping for personal use sits in a ToS gray area; this is a single-user homelab tool with polite, low-volume access.