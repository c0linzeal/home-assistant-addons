'use strict';

const cheerio = require('cheerio');
const {
  toHalfWidth, parseManYen, parseArea, parseBuildingAgeYears,
} = require('../lib/normalize');
const { fetchHtml } = require('../lib/http');
const { applyFilters } = require('./athome');

const BASE = 'https://www.homes.co.jp';
const PAGES_TO_FETCH = 3;

// Jittered delay between page fetches (1500–3000 ms) to be polite to the live site.
function jitteredSleep() {
  const ms = 1500 + Math.floor(Math.random() * 1500);
  return new Promise((r) => setTimeout(r, ms));
}

// HOME'S transit format: "LINE STATION名 徒歩N分" (no 「」 brackets).
// Extract station (anything ending in 駅 before 徒歩) and walk minutes.
function parseHomesTransit(text) {
  if (!text) return { station: null, walkMin: null };
  const s = toHalfWidth(text.trim());
  const stationM = s.match(/\s([^\s]+駅)/);
  const walkM = s.match(/徒歩\s*(\d+)\s*分/);
  return {
    station: stationM ? stationM[1] : null,
    walkMin: walkM ? parseInt(walkM[1], 10) : null,
  };
}

// HOME'S building age: "2020年02月（築7年）" — parseBuildingAgeYears handles "築N年".
// Returns { raw, years } or null.
function parseBuildingAge(text) {
  if (!text) return null;
  const raw = toHalfWidth(text.trim());
  const years = parseBuildingAgeYears(raw);
  return { raw, years };
}

function parseListings(html) {
  const $ = cheerio.load(html);
  const listings = [];

  // Iterate ORGANIC building cards only.
  // div.mod-listKks / div.mod-listKks-sale are sponsored containers —
  // using div.mod-mergeBuilding--sale already excludes them.
  $('div.mod-mergeBuilding--sale').each((_, cardEl) => {
    const card = $(cardEl);

    // ── Building-level fields ─────────────────────────────────────────────────

    // Title: span.bukkenName inside h3.heading a.prg-bukkenNameAnchor
    const title = card.find('h3.heading a.prg-bukkenNameAnchor .bukkenName').first().text().trim() || null;

    // Detail URL: href on the anchor (already absolute on HOME'S)
    const rawHref = card.find('a.prg-bukkenNameAnchor').first().attr('href') || null;
    const url = rawHref
      ? (rawHref.startsWith('http') ? rawHref : BASE + rawHref)
      : null;

    // Thumbnail: img.prg-lazy → data-original; fall back to noscript img src
    let thumbnail = null;
    const lazyImg = card.find('img.prg-lazy').first();
    if (lazyImg.length) {
      thumbnail = lazyImg.attr('data-original') || lazyImg.attr('src') || null;
    }
    if (!thumbnail || /loading/i.test(thumbnail)) {
      const noscriptSrc = card.find('noscript img').first().attr('src');
      if (noscriptSrc) thumbnail = noscriptSrc;
    }
    // Reject spinner placeholder
    if (thumbnail && /loading/i.test(thumbnail)) thumbnail = null;

    // Building age: th containing "築年月" → sibling td
    let ageRaw = null;
    card.find('th').each((_, th) => {
      if ($(th).text().includes('築年月')) {
        ageRaw = $(th).next('td').text().trim();
        return false; // break
      }
    });
    const buildingAge = parseBuildingAge(ageRaw);

    // Transit + address: one td (br-separated) under th containing "交通"
    let station = null;
    let walkMin = null;
    let address = null;
    card.find('th').each((_, th) => {
      if ($(th).text().includes('交通')) {
        const td = $(th).next('td');
        const cellHtml = td.html() || '';
        const parts = cellHtml.split(/<br\s*\/?>/i);
        const transitText = toHalfWidth(parts[0].replace(/<[^>]+>/g, '').trim());
        const addrText = toHalfWidth((parts[1] || '').replace(/<[^>]+>/g, '').trim());
        const transit = parseHomesTransit(transitText);
        station = transit.station;
        walkMin = transit.walkMin;
        address = addrText || null;
        return false; // break
      }
    });

    // ── Unit-level rows ───────────────────────────────────────────────────────

    const unitRows = card.find('tr.raSpecRow');

    if (unitRows.length === 0) {
      // Building with no unit rows: emit one skeleton listing with null unit fields.
      if (title && url) {
        listings.push({
          source: 'homes',
          title,
          price: { yen: null, raw: '' },
          layout: null,
          areaSqm: null,
          buildingAge,
          walkMin,
          station,
          address,
          thumbnail,
          url,
        });
      }
      return;
    }

    unitRows.each((_, rowEl) => {
      const row = $(rowEl);
      const info = row.find('td.info');

      // Price: th:contains("価格") + td — e.g. "4,780万円"
      const priceText = info.find('th:contains("価格")').first().next('td').text().trim();
      // Layout: th:contains("間取り") + td
      const layoutRaw = info.find('th:contains("間取り")').first().next('td').text().trim();
      // Area: th:contains("専有面積") + td
      const areaRaw = info.find('th:contains("専有面積")').first().next('td').text().trim();

      listings.push({
        source: 'homes',
        title,
        price: {
          yen: parseManYen(priceText),
          raw: toHalfWidth(priceText),
        },
        layout: layoutRaw ? toHalfWidth(layoutRaw) : null,
        areaSqm: areaRaw ? parseArea(areaRaw) : null,
        buildingAge,
        walkMin,
        station,
        address,
        thumbnail,
        url,
      });
    });
  });

  return listings;
}

// Detect a blocked / challenge page rather than a real listings page.
function looksBlocked(html) {
  if (!html) return true;
  if (html.length < 20000 && !/mod-mergeBuilding/.test(html)) return true;
  return false;
}

// HOME'S used-mansion listings for Chiba prefecture.
// City slug for non-major cities is not reliable (JS-rendered nav), so we use
// prefecture-wide and filter by address client-side.
// Page 1: https://www.homes.co.jp/mansion/chuko/chiba/list/
// Page N: ?page=N
function buildUrl({ page = 1 } = {}) {
  const base = `${BASE}/mansion/chuko/chiba/list/`;
  return page > 1 ? `${base}?page=${page}` : base;
}

async function search(filters) {
  const all = [];

  for (let page = 1; page <= PAGES_TO_FETCH; page++) {
    const url = buildUrl({ page });
    let html;
    try {
      html = await fetchHtml(url, { timeoutMs: 12000 });
    } catch (err) {
      if (page === 1) throw err;
      break;
    }

    if (looksBlocked(html)) {
      if (page === 1) {
        throw new Error('HOME\'S served a non-listing page (no listings retrievable)');
      }
      break;
    }

    const parsed = parseListings(html);
    if (parsed.length === 0) {
      if (page === 1) {
        throw new Error('HOME\'S returned 0 listings on page 1 (possible structure change or block)');
      }
      break;
    }

    all.push(...parsed);

    // Jittered politeness delay between pages
    if (page < PAGES_TO_FETCH) await jitteredSleep();
  }

  // City filtering: no reliable city URL slug → filter by address text client-side.
  const listings = applyFilters(all, {
    minYen: filters.minYen,
    maxYen: filters.maxYen,
    layoutKey: filters.layoutKey,
    walkMax: filters.walkMax,
    ageMaxYears: filters.ageMaxYears,
    addressContains: filters.cityJa || null,
  });

  return {
    source: 'homes',
    status: 'ok',
    count: listings.length,
    listings,
    scanned: all.length,
  };
}

module.exports = { source: 'homes', parseListings, buildUrl, search };
