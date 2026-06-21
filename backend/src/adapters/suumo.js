'use strict';

const cheerio = require('cheerio');
const {
  toHalfWidth, parseManYen, parseArea, parseTransit,
} = require('../lib/normalize');
const { fetchHtml } = require('../lib/http');
const { applyFilters } = require('./athome');

const BASE = 'https://suumo.jp';
// MVP: used apartments (chuko mansion) in Chiba prefecture.
const BASE_URL = `${BASE}/jj/bukken/ichiran/JJ010FJ001/?ar=030&bs=011&ta=12`;

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

function parseListings(html) {
  const $ = cheerio.load(html);
  const listings = [];

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

    // Layout, area, address, transit
    const layoutRaw = readField($, card, '間取り');
    const areaRaw = readField($, card, '専有面積');
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
      buildingAge: ageRaw ? { raw: ageRaw, years: ageYears } : null,
      walkMin: transit ? transit.walkMin : null,
      station: transit ? transit.station : null,
      address: addressRaw ? toHalfWidth(addressRaw) : null,
      thumbnail: thumbnail || null,
      url,
    });
  });

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
// - jis: JIS municipality code string (e.g. "12204" for Funabashi) — appended as &sc=
//   Umbrella codes (e.g. 12100 for Chiba City) are skipped; address filter handles those.
// - page: page number (omit or 1 = no param appended)
function buildUrl({ jis, page = 1 } = {}) {
  let url = BASE_URL;
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
  const all = [];
  // For umbrella JIS codes, sc= is not emitted; filter results by city name instead.
  const addressContains = (filters.jis && UMBRELLA_JIS.has(String(filters.jis).trim()))
    ? (filters.cityJa || null)
    : null;

  for (let page = 1; page <= PAGES_TO_FETCH; page++) {
    const url = buildUrl({ jis: filters.jis, page });
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

    const parsed = parseListings(html);
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
