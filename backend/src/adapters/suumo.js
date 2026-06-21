'use strict';

const cheerio = require('cheerio');
const {
  toHalfWidth, parseManYen, parseArea, parseTransit,
} = require('../lib/normalize');
const { fetchHtml } = require('../lib/http');
const { applyFilters } = require('./athome');

const BASE = 'https://suumo.jp';

// bs= values per property type
const BS = {
  used_apartment: '011',
  new_apartment:  '010',
  used_house:     '021',
  new_house:      '020',
};

// Designated-city umbrella JIS codes that SUUMO's sc= param doesn't accept.
// For these, fall back to prefecture-wide fetch + client-side address filter.
const UMBRELLA_JIS = new Set(['12100']); // designated-city umbrella codes SUUMO sc= doesn't accept -> use prefecture-wide + address filter

const PAGES_TO_FETCH = 3;

// Jittered delay between page fetches (1500–3000 ms) to be polite to the live site.
function jitteredSleep() {
  const ms = 1500 + Math.floor(Math.random() * 1500);
  return new Promise((r) => setTimeout(r, ms));
}

// SUUMO building age is given as "YYYY年MM月" (e.g. "1973年10月").
// Convert to years since construction (floor) relative to current year.
function parseSuumoBuildingAge(text) {
  if (!text) return null;
  const s = toHalfWidth(text.trim());
  // Match "YYYY年" anywhere in the string
  const m = s.match(/(\d{4})年/);
  if (!m) return null;
  const builtYear = parseInt(m[1], 10);
  if (builtYear < 1900 || builtYear > 2100) return null;
  const currentYear = new Date().getFullYear();
  const years = currentYear - builtYear;
  return Math.max(0, years);
}

// Read a field value from a property_unit card by label text.
// Uses dt:contains("LABEL") + dd which works across the nested dottable structure.
function readField($, card, label) {
  const dd = card.find(`dt:contains("${label}")`).first().next('dd');
  if (!dd.length) return null;
  return dd.text().trim() || null;
}

// Parse a cassette_price-description block: "2LDK～3LDK\n/\n61.36m2～80.84m2"
// Returns { layout: string|null, areaSqm: number|null }
function parsePriceDescription(text) {
  if (!text) return { layout: null, areaSqm: null };
  const s = toHalfWidth(text).replace(/\s+/g, ' ').trim();
  // Layout: anything like 1R, 1K, 1LDK, 2LDK～3LDK etc — first token before /
  const layoutM = s.match(/^([^/]+)/);
  const layout = layoutM ? layoutM[1].trim() : null;
  // Area: first number followed by m2 or ㎡
  const areaM = s.match(/([\d.]+)\s*m2/i);
  const areaSqm = areaM ? parseFloat(areaM[1]) : null;
  return { layout, areaSqm };
}

// Parse listings from a SUUMO listing page HTML.
// propertyType: 'used_apartment' | 'new_apartment' | 'used_house' | 'new_house'
function parseListings(html, propertyType = 'used_apartment') {
  const $ = cheerio.load(html);
  const listings = [];

  if (propertyType === 'new_apartment') {
    // bs=010: property_unit cards with cassette inner structure
    $('div.property_unit').each((_, el) => {
      const card = $(el);

      // Title and URL via cassette_header-title
      const titleEl = card.find('a.cassette_header-title').first();
      const title = titleEl.text().trim() || null;
      const href = titleEl.attr('href') || null;
      const url = href ? (href.startsWith('http') ? href : BASE + href) : null;

      if (!title || !url) return;

      // Price: span.cassette_price-accent text like "4900万円台～7300万円台／予定"
      const priceRaw = card.find('span.cassette_price-accent').first().text().trim() || null;

      // Layout + area from cassette_price-description
      const priceDescRaw = card.find('.cassette_price-description').first().text().trim();
      const { layout, areaSqm } = parsePriceDescription(priceDescRaw);

      // Address and transit from cassette_basic-title/cassette_basic-value pairs
      let addressRaw = null;
      let transitRaw = null;
      card.find('p.cassette_basic-title').each((__, labelEl) => {
        const label = $(labelEl).text().trim();
        const val = $(labelEl).next('p.cassette_basic-value').text().trim();
        if (label === '所在地') addressRaw = val || null;
        if (label === '交通') transitRaw = val || null;
      });

      // Thumbnail: img.js-scrollLazy, real URL in rel attr
      const thumbImg = card.find('img.js-scrollLazy').first();
      const thumbnail = thumbImg.attr('rel') || thumbImg.attr('src') || null;

      const transit = transitRaw ? parseTransit(transitRaw) : null;

      listings.push({
        source: 'suumo',
        title,
        price: { yen: parseManYen(priceRaw || ''), raw: priceRaw ? toHalfWidth(priceRaw) : null },
        layout: layout || null,
        areaSqm,
        landSqm: null, // no land area for apartments
        buildingAge: null, // new builds have 引渡時期, not 築年月
        walkMin: transit ? transit.walkMin : null,
        station: transit ? transit.station : null,
        address: addressRaw ? toHalfWidth(addressRaw) : null,
        thumbnail: thumbnail || null,
        url,
      });
    });
  } else {
    // bs=011/021/020: property_unit cards with dt/dd dottable structure
    const isHouse = propertyType === 'used_house' || propertyType === 'new_house';

    $('div.property_unit').each((_, el) => {
      const card = $(el);

      // Title and URL
      const titleEl = card.find('h2.property_unit-title a').first();
      const title = titleEl.text().trim() || null;
      const href = titleEl.attr('href') || null;
      const url = href ? (href.startsWith('http') ? href : BASE + href) : null;

      // Skip cards with no title or url (malformed / non-listing entries)
      if (!title || !url) return;

      // Price: dd contains a span.dottable-value with e.g. "1280万円"
      const priceRaw = readField($, card, '販売価格');

      // Layout
      const layoutRaw = readField($, card, '間取り');

      // Area: houses use 建物面積 for areaSqm + 土地面積 for landSqm
      //       apartments use 専有面積 for areaSqm, landSqm is null
      let areaRaw, landRaw;
      if (isHouse) {
        areaRaw = readField($, card, '建物面積');
        landRaw = readField($, card, '土地面積');
      } else {
        areaRaw = readField($, card, '専有面積');
        landRaw = null;
      }

      const addressRaw = readField($, card, '所在地');
      const transitRaw = readField($, card, '沿線・駅');
      const ageRaw = readField($, card, '築年月');

      // Thumbnail: first img.js-scrollLazy; real URL is in the `rel` attribute
      const thumbImg = card.find('img.js-scrollLazy').first();
      const thumbnail = (thumbImg.attr('rel') || thumbImg.attr('src') || null);

      const transit = transitRaw ? parseTransit(transitRaw) : null;
      const ageYears = parseSuumoBuildingAge(ageRaw);

      listings.push({
        source: 'suumo',
        title,
        price: { yen: parseManYen(priceRaw || ''), raw: priceRaw ? toHalfWidth(priceRaw) : null },
        layout: layoutRaw ? toHalfWidth(layoutRaw) : null,
        areaSqm: areaRaw ? parseArea(areaRaw) : null,
        landSqm: landRaw ? parseArea(landRaw) : null,
        buildingAge: ageRaw ? { raw: ageRaw, years: ageYears } : null,
        walkMin: transit ? transit.walkMin : null,
        station: transit ? transit.station : null,
        address: addressRaw ? toHalfWidth(addressRaw) : null,
        thumbnail: thumbnail || null,
        url,
      });
    });
  }

  return listings;
}

// Detect a blocked / challenge page rather than a real listings page.
function looksBlocked(html) {
  if (!html) return true;
  // A real SUUMO page has property_unit divs and is sizable
  if (html.length < 20000 && !/property_unit/.test(html)) return true;
  return false;
}

// Build a SUUMO listings URL.
// - propertyType: one of used_apartment|new_apartment|used_house|new_house (maps to bs=)
// - jis: JIS municipality code string (e.g. "12204" for Funabashi) — appended as &sc=
//   Umbrella codes (e.g. 12100 for Chiba City) are skipped; address filter handles those.
// - page: page number (omit or 1 = no param appended)
function buildUrl({ propertyType = 'used_apartment', jis, page = 1 } = {}) {
  const bs = BS[propertyType] || '011';
  let url = `${BASE}/jj/bukken/ichiran/JJ010FJ001/?ar=030&bs=${bs}&ta=12`;
  if (jis && String(jis).trim() && !UMBRELLA_JIS.has(String(jis).trim())) {
    url += `&sc=${encodeURIComponent(jis)}`;
  }
  if (page > 1) url += `&page=${page}`;
  return url;
}

// Fetch up to PAGES_TO_FETCH pages, parse, then apply client-side filters.
// For leaf city codes, sc= does server-side filtering (addressContains stays null).
// For umbrella codes (e.g. 12100 Chiba City), sc= is skipped and we filter by address.
async function search(filters) {
  const propertyType = filters.propertyType || 'used_apartment';
  const all = [];
  // For umbrella JIS codes, sc= is not emitted; filter results by city name instead.
  const addressContains = (filters.jis && UMBRELLA_JIS.has(String(filters.jis).trim()))
    ? (filters.cityJa || null)
    : null;

  for (let page = 1; page <= PAGES_TO_FETCH; page++) {
    const url = buildUrl({ propertyType, jis: filters.jis, page });
    let html;
    try {
      html = await fetchHtml(url, { timeoutMs: 12000 });
    } catch (err) {
      if (page === 1) throw err;
      break;
    }

    if (looksBlocked(html)) {
      if (page === 1) {
        throw new Error('SUUMO served a non-listing page (possible block or challenge)');
      }
      break;
    }

    const parsed = parseListings(html, propertyType);
    if (parsed.length === 0) {
      if (page === 1) {
        throw new Error('SUUMO returned 0 listings on page 1 (possible structure change or block)');
      }
      break;
    }

    all.push(...parsed);

    // Jittered politeness delay between pages
    if (page < PAGES_TO_FETCH) await jitteredSleep();
  }

  // City filtering: leaf codes use server-side sc=; umbrella codes use addressContains.
  const listings = applyFilters(all, {
    minYen: filters.minYen,
    maxYen: filters.maxYen,
    layoutKey: filters.layoutKey,
    walkMax: filters.walkMax,
    ageMaxYears: filters.ageMaxYears,
    addressContains,
  });

  return {
    source: 'suumo',
    status: 'ok',
    count: listings.length,
    listings,
    scanned: all.length,
  };
}

module.exports = { source: 'suumo', parseListings, buildUrl, search };
