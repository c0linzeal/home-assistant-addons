'use strict';

const cheerio = require('cheerio');
const {
  toHalfWidth, parseManYen, parseArea, parseBuildingAgeYears, parseTransit,
} = require('../lib/normalize');
const { fetchHtml } = require('../lib/http');
const { applyFilters } = require('./athome');

const BASE = 'https://www.homes.co.jp';
const PAGES_TO_FETCH = 3;

// URL path prefixes per property type
const PATHS = {
  used_apartment: 'mansion/chuko',
  new_apartment:  'mansion/shinchiku',
  used_house:     'kodate/chuko',
  new_house:      'kodate/shinchiku',
};

// Jittered delay between page fetches (1500–3000 ms) to be polite to the live site.
function jitteredSleep() {
  const ms = 1500 + Math.floor(Math.random() * 1500);
  return new Promise((r) => setTimeout(r, ms));
}

// HOME'S transit format (used_apartment / used_house outer card):
// "LINE STATION名 徒歩N分" — no 「」 brackets. The sec-specB cell holds transit+address
// separated by <br>. Extract station and walk minutes from the transit portion.
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

// Parse a flat-table card (new_house / new_mansion / new_apartment) that has
// no tr.raSpecRow and no div.sec-specB. All fields are in a single <table>
// inside the card. Returns one listing object or null.
function parseFlatTableCard($, card, propertyType) {
  const isHouse = propertyType === 'used_house' || propertyType === 'new_house';

  // Title
  const title = card.find('h3.heading a .bukkenName').first().text().trim() || null;

  // URL (already absolute on HOME'S)
  const rawHref = card.find('h3.heading a').first().attr('href') || null;
  const url = rawHref
    ? (rawHref.startsWith('http') ? rawHref : BASE + rawHref)
    : null;

  if (!title || !url) return null;

  // Thumbnail: flat-table cards may have img.prg-lazy with data-original (new mansion)
  // or a direct src img (new house: img[fetchpriority="high"] or img.u-max-w-full).
  let thumbnail = null;
  const lazyImg = card.find('img.prg-lazy').first();
  if (lazyImg.length) {
    const orig = lazyImg.attr('data-original');
    if (orig && !/loading/i.test(orig)) thumbnail = orig;
  }
  if (!thumbnail) {
    const highImg = card.find('img[fetchpriority="high"]').first();
    if (highImg.length) {
      const src = highImg.attr('src');
      if (src && !/loading/i.test(src)) thumbnail = src;
    }
  }
  if (!thumbnail) {
    const fullImg = card.find('img.u-max-w-full').first();
    if (fullImg.length) {
      const src = fullImg.attr('src');
      if (src && !/loading/i.test(src)) thumbnail = src;
    }
  }

  // All fields from first table's th→td pairs
  const firstTable = card.find('table').first();

  function readTh(label) {
    return firstTable.find(`th:contains("${label}")`).first().next('td').text().trim() || null;
  }

  const priceText = readTh('価格');
  const layoutRaw = readTh('間取り');
  const addrRaw = readTh('所在地');
  const transitRaw = readTh('交通');

  // Area fields by type
  let areaRaw = null;
  let landRaw = null;
  if (isHouse) {
    areaRaw = readTh('建物面積');
    landRaw = readTh('土地面積');
  } else {
    // apartment
    areaRaw = readTh('専有面積');
    landRaw = null;
  }

  // Transit: flat table gives the full transit text; use parseTransit (handles 「」 brackets)
  // Take only the first line/segment (before <br> or ／) to get primary station.
  let station = null;
  let walkMin = null;
  if (transitRaw) {
    const firstLine = toHalfWidth(transitRaw).split(/[\n／]/)[0].trim();
    const t = parseTransit(firstLine);
    if (t) {
      station = t.station;
      walkMin = t.walkMin;
    }
  }

  // Address: normalize ヶ→ケ
  const address = addrRaw
    ? toHalfWidth(addrRaw).replace(/ヶ/g, 'ケ')
    : null;

  return {
    source: 'homes',
    title,
    price: {
      yen: parseManYen(priceText || ''),
      raw: priceText ? toHalfWidth(priceText) : null,
    },
    layout: layoutRaw ? toHalfWidth(layoutRaw) : null,
    areaSqm: areaRaw ? parseArea(areaRaw) : null,
    landSqm: landRaw ? parseArea(landRaw) : null,
    buildingAge: null, // new builds don't have 築年月
    walkMin,
    station,
    address,
    thumbnail,
    url,
  };
}

// Parse listings from a HOME'S listing page HTML.
// propertyType: 'used_apartment' | 'new_apartment' | 'used_house' | 'new_house'
function parseListings(html, propertyType = 'used_apartment') {
  const $ = cheerio.load(html);
  const listings = [];
  const isHouse = propertyType === 'used_house' || propertyType === 'new_house';

  // Area label for unit rows (used_apartment / used_house have tr.raSpecRow)
  const areaLabel = isHouse ? '建物面積' : '専有面積';
  const landLabel = isHouse ? '土地面積' : null;

  // Iterate ORGANIC building cards only.
  // div.mod-mergeBuilding--sale already excludes sponsored div.mod-listKks containers.
  $('div.mod-mergeBuilding--sale').each((_, cardEl) => {
    const card = $(cardEl);

    // ── Building-level fields (present in all types) ──────────────────────────

    const title = card.find('h3.heading a .bukkenName').first().text().trim() || null;

    const rawHref = card.find('h3.heading a').first().attr('href') || null;
    const url = rawHref
      ? (rawHref.startsWith('http') ? rawHref : BASE + rawHref)
      : null;

    // ── Unit rows (used_apartment and used_house) ─────────────────────────────
    const unitRows = card.find('tr.raSpecRow');

    // ── Building-level metadata (used by both unit-row path and skeleton fallback) ──

    // Thumbnail: img.prg-lazy → data-original (building-level outer card)
    let thumbnail = null;
    const lazyImg = card.find('img.prg-lazy').first();
    if (lazyImg.length) {
      thumbnail = lazyImg.attr('data-original') || lazyImg.attr('src') || null;
    }
    if (!thumbnail || /loading/i.test(thumbnail)) {
      const noscriptSrc = card.find('noscript img').first().attr('src');
      if (noscriptSrc) thumbnail = noscriptSrc;
    }
    if (thumbnail && /loading/i.test(thumbnail)) thumbnail = null;

    // Building age from outer th with 築年月
    let ageRaw = null;
    card.find('th').each((_, th) => {
      if ($(th).text().includes('築年月')) {
        ageRaw = $(th).next('td').text().trim();
        return false;
      }
    });
    const buildingAge = parseBuildingAge(ageRaw);

    // Transit + address from outer th containing "交通" — br-separated:
    // first line = transit, second line = address.
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
        address = addrText ? addrText.replace(/ヶ/g, 'ケ') : null;
        return false;
      }
    });

    if (unitRows.length > 0) {
      // ── Has unit rows: used_apartment or used_house ──────────────────────────

      // Flatten unit rows — one listing per unit
      unitRows.each((_, rowEl) => {
        const row = $(rowEl);
        const info = row.find('td.info');

        const priceText = info.find('th:contains("価格")').first().next('td').text().trim();
        const layoutRaw = info.find('th:contains("間取り")').first().next('td').text().trim();
        const areaRaw = info.find(`th:contains("${areaLabel}")`).first().next('td').text().trim();
        const landRaw = landLabel
          ? info.find(`th:contains("${landLabel}")`).first().next('td').text().trim()
          : null;

        listings.push({
          source: 'homes',
          title,
          price: {
            yen: parseManYen(priceText),
            raw: toHalfWidth(priceText),
          },
          layout: layoutRaw ? toHalfWidth(layoutRaw) : null,
          areaSqm: areaRaw ? parseArea(areaRaw) : null,
          landSqm: landRaw ? parseArea(landRaw) : null,
          buildingAge,
          walkMin,
          station,
          address,
          thumbnail,
          url,
        });
      });
    } else {
      // ── No unit rows: new_house, new_apartment (flat table) ─────────────────
      // Also handles old used_apartment zero-unit skeleton gracefully.
      // For new builds, parse from flat table. For legacy no-unit case, emit skeleton.

      if (propertyType === 'new_house' || propertyType === 'new_apartment') {
        const listing = parseFlatTableCard($, card, propertyType);
        if (listing) listings.push(listing);
      } else if (title && url) {
        // Skeleton fallback for used types with unexpectedly zero unit rows.
        // Use building-level metadata already extracted above; price/layout/area are
        // unit-level and legitimately absent.
        listings.push({
          source: 'homes',
          title,
          price: { yen: null, raw: null },
          layout: null,
          areaSqm: null,
          landSqm: null,
          buildingAge,
          walkMin,
          station,
          address,
          thumbnail,
          url,
        });
      }
    }
  });

  return listings;
}

// Detect a blocked / challenge page rather than a real listings page.
function looksBlocked(html) {
  if (!html) return true;
  if (html.length < 20000 && !/mod-mergeBuilding/.test(html)) return true;
  return false;
}

// Build a HOME'S listings URL.
// propertyType → path prefix; always Chiba prefecture; pagination ?page=N.
function buildUrl({ propertyType = 'used_apartment', page = 1 } = {}) {
  const pathPrefix = PATHS[propertyType] || PATHS.used_apartment;
  const base = `${BASE}/${pathPrefix}/chiba/list/`;
  return page > 1 ? `${base}?page=${page}` : base;
}

async function search(filters) {
  const propertyType = filters.propertyType || 'used_apartment';
  const all = [];

  for (let page = 1; page <= PAGES_TO_FETCH; page++) {
    const url = buildUrl({ propertyType, page });
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

    const parsed = parseListings(html, propertyType);
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
  // Normalize ヶ→ケ in the filter value to match the normalized address from parseListings.
  const addressContains = filters.cityJa
    ? filters.cityJa.normalize('NFKC').replace(/ヶ/g, 'ケ')
    : null;
  const listings = applyFilters(all, {
    minYen: filters.minYen,
    maxYen: filters.maxYen,
    layoutKey: filters.layoutKey,
    walkMax: filters.walkMax,
    ageMaxYears: filters.ageMaxYears,
    addressContains,
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
