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
      price: { yen: parseManYen(priceRaw || ''), raw: toHalfWidth(priceRaw || '') },
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
// - page: page number (omit or 1 = no param appended)
function buildUrl({ jis, page = 1 } = {}) {
  let url = BASE_URL;
  if (jis && String(jis).trim()) url += `&sc=${encodeURIComponent(jis)}`;
  if (page > 1) url += `&page=${page}`;
  return url;
}

// Fetch up to PAGES_TO_FETCH pages, parse, then apply client-side filters.
// SUUMO filters city server-side via sc= so we do NOT apply addressContains.
async function search(filters) {
  const all = [];

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

  // City filtering is handled server-side by sc= param; do NOT pass addressContains.
  const listings = applyFilters(all, {
    minYen: filters.minYen,
    maxYen: filters.maxYen,
    layoutKey: filters.layoutKey,
    walkMax: filters.walkMax,
    ageMaxYears: filters.ageMaxYears,
    addressContains: null,
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
