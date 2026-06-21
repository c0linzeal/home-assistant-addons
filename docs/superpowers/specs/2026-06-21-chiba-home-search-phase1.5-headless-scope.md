# Chiba Home Search — Phase 1.5 Scope: Headless Browser for City-Level AtHome

- **Date:** 2026-06-21
- **Status:** Scoping only — NOT approved for build. Spike required before committing.
- **Depends on:** Phase 0 (live AtHome listings via lightweight HTTP + cheerio), already shipped.

## Goal

Make **city-level** AtHome searches return live listings (Funabashi, Matsudo, etc.), which Phase 0 cannot do, and improve resilience when AtHome challenges the prefecture-wide URL under load.

## Why Phase 0 can't do it

Phase 0 fetches AtHome pages with a plain server-side HTTP GET and parses the HTML with cheerio. This works for the prefecture-wide URL, but AtHome serves an **anti-bot challenge page** (`<title>【アットホーム】認証中</title>`, an Imperva/Incapsula "Reese84" JavaScript gate, no listing cards) for city-level URLs. Phase 0 now **detects** that challenge (`looksBlocked`) and reports the portal as `status: "unavailable"`, so the UI falls back to the click-out links instead of showing a false "0 results". To actually retrieve city listings, something must **execute the challenge's JavaScript** to obtain the clearance cookie before requesting the listing HTML.

## The key risk (read this first)

**A headless browser is not guaranteed to defeat this challenge.** Imperva/Reese84-class systems actively fingerprint and block headless browsers (they check `navigator.webdriver`, missing plugins, canvas/WebGL fingerprints, timing, etc.). A vanilla Playwright/Puppeteer run is often challenged or blocked just like plain HTTP. Getting through typically requires some combination of: a stealth-hardened browser context (`playwright-extra` + stealth, or `puppeteer-extra-plugin-stealth`), a realistic non-headless-looking fingerprint, solving/passing the JS challenge to capture the `reese84`/clearance cookie, and possibly a residential/clean egress IP (our homelab IP is already rate-limited from Phase 0 testing). None of this is guaranteed, and it is an ongoing arms race that can break without notice.

**Therefore the first deliverable of Phase 1.5 is a feasibility spike, not an implementation.** This mirrors Phase 0, where a spike confirmed the approach before we built it.

## Recommended first step: feasibility spike (time-boxed)

Stand up a throwaway Playwright + Chromium (with a stealth plugin) and point it at a city URL, e.g. `https://www.athome.co.jp/mansion/chuko/chiba/funabashi-city/list/`. Determine, from this server:
1. Does the stealth headless browser pass the `認証中` challenge and load the real listing DOM (cards with `card-box open` / prices)?
2. If yes: can we capture the clearance cookie and reuse it for subsequent plain-HTTP fetches (cheap), or must every fetch go through the browser?
3. How long does a city fetch take end-to-end (challenge solve + render)? Is it acceptable (a few seconds)?
4. Does it work without a proxy, or is the homelab IP too burned? (Re-test after the current rate-limit cooldown.)

If the spike fails (still blocked), STOP and reconsider alternatives (see below) rather than escalating into proxies/CAPTCHA-solving services for a personal tool.

## Architecture (only if the spike succeeds)

**Reuse:** the existing cheerio adapters, `parseListings`, `applyFilters`, city-slug map, and the `/api/search` contract stay unchanged — only the **fetch layer** changes (a headless fetch returns rendered HTML that is fed to the same `parseListings`).

**Recommended shape — hybrid, pay the cost only when needed:**
- Keep the cheap HTTP path (`fetchHtml`) for prefecture-wide, which already works.
- Add a headless fetch path used only when the cheap path returns a challenge (`looksBlocked`) — i.e. city-level and blocked cases.
- Run headless Chromium in its own container (`chiba-home-search-browser`, ~1GB image) on the compose network; the backend calls it (or embeds Playwright directly — decide in the plan). Reuse the clearance cookie across requests within its TTL to minimize browser launches and stay polite.

**Alternative (simpler, heavier):** route all fetches through the headless browser. Slower and more resource-hungry; rejected unless the hybrid proves too complex.

## Trade-offs to accept if built

- Image size jumps from a tiny `node:alpine` to ~1GB (Chromium); higher memory/CPU; per-search latency in seconds, not milliseconds.
- More fragile: anti-bot changes can break it; needs occasional maintenance.
- Politeness matters even more (slower cadence, cookie reuse, low volume) to avoid hardening the block.

## Alternatives if headless is not feasible

- Accept Phase 0's behavior: prefecture-wide live + city-level falls back to the (working) click-out links.
- Prioritize **Phase 1** instead (SUUMO + HOME'S adapters via the same lightweight pattern) for more coverage without a browser.
- Investigate any official AtHome data feed / partner API (likely unavailable, but cheaper if it exists).

## Open questions

- Does stealth headless actually pass AtHome's challenge from this server IP? (Spike answers this.)
- Is a clean egress IP / proxy required? Acceptable for a personal homelab tool?
- Cookie/session TTL — how often must the challenge be re-solved?
- Is the added container weight and latency worth city-level coverage, vs. just shipping more portals (Phase 1)?

## Decision gate

Run the spike → if it cleanly returns city listings at acceptable cost, write a full implementation plan (hybrid fetch layer + browser container, TDD, fixture-based parser reuse). If not, fall back to Phase 1 (more portals) and keep the graceful link fallback for cities.
