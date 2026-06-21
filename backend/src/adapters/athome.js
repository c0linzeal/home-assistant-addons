'use strict';

const cheerio = require('cheerio');
const {
  toHalfWidth, parseManYen, parseArea, parseBuildingAgeYears, parseTransit,
} = require('../lib/normalize');
const { fetchHtml } = require('../lib/http');

const BASE = 'https://www.athome.co.jp';

const PAGES_TO_FETCH = 3;
const PAGE_DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// AtHome detail rows are label-keyed: <strong>LABEL</strong><span>VALUE</span>.
// Match by label text, not position (row count varies per card).
function readDetail($, card, label) {
  let value = null;
  card.find('.property-detail-table__block').each((_, el) => {
    const strong = toHalfWidth($(el).find('strong').first().text());
    if (strong === label) {
      value = $(el).find('span').first().text().trim();
      return false;
    }
  });
  return value;
}

function pickThumbnail($, card) {
  let thumb = null;
  card.find('li.swiper-slide.bukken-item img').each((_, img) => {
    const src = $(img).attr('src');
    if (src && !/loading_g/.test(src)) { thumb = src; return false; }
  });
  return thumb;
}

function parseListings(html) {
  const $ = cheerio.load(html);
  const listings = [];
  $('div.card-box.open').each((_, el) => {
    const card = $(el);
    const priceText = card.find('.property-price').first().text();
    const layoutRaw = readDetail($, card, '間取り');
    const areaRaw = readDetail($, card, '専有面積');
    const ageRaw = readDetail($, card, '築年月');
    const addressRaw = readDetail($, card, '所在地');
    const transitRaw = readDetail($, card, '交通');

    const titleEl = card.find('.card-box-inner__head .title-wrap__title-text').first();
    const title = $(titleEl).clone().children('p').remove().end()
      .text().replace(/\s+/g, ' ').trim();

    const href = card.find('a.select-link').first().attr('href')
      || card.find('.card-box-open > a').first().attr('href');
    const url = href ? (href.startsWith('http') ? href : BASE + href) : null;

    const transit = transitRaw ? parseTransit(transitRaw) : null;

    listings.push({
      source: 'athome',
      title,
      price: { yen: parseManYen(priceText), raw: toHalfWidth(priceText) },
      layout: layoutRaw ? toHalfWidth(layoutRaw) : null,
      areaSqm: areaRaw ? parseArea(areaRaw) : null,
      buildingAge: ageRaw ? { raw: ageRaw, years: parseBuildingAgeYears(ageRaw) } : null,
      walkMin: transit ? transit.walkMin : null,
      station: transit ? transit.station : null,
      address: addressRaw ? toHalfWidth(addressRaw) : null,
      thumbnail: pickThumbnail($, card),
      url,
    });
  });
  return listings;
}

// AtHome sometimes serves an anti-bot challenge page (esp. city-level URLs)
// instead of listings: a small page titled 認証中 with a JS protection gate and
// no listing cards. Detect it so we report "unavailable" rather than a false 0.
function looksBlocked(html) {
  if (!html) return true;
  if (/認証中/.test(html)) return true;
  if (/onProtectionInitialized|Reese84|Incapsula|_Incapsula_Resource/.test(html)) return true;
  // A real listings page is large and contains the card container; a challenge
  // shell is tiny. Treat a short page with no cards as blocked.
  if (html.length < 20000 && !/card-box open/.test(html)) return true;
  return false;
}

// JIS municipality code -> AtHome city slug. Only slugs confirmed present on
// AtHome are mapped; everything else (incl. ward-split Chiba City 12100) falls
// back to prefecture-wide so we never request a 404 path.
const CITY_SLUGS = {
  '12204': 'funabashi-city',
  '12203': 'ichikawa-city',
  '12207': 'matsudo-city',
  '12217': 'kashiwa-city',
  '12219': 'ichihara-city',
  '12206': 'kisarazu-city',
  '12220': 'nagareyama-city',
  '12224': 'kamagaya-city',
  '12231': 'inzai-city',
  '12210': 'mobara-city',
  '12202': 'choshi-city',
  '12225': 'kimitsu-city',
  '12222': 'abiko-city',
};

function citySlugFor(jis) {
  return CITY_SLUGS[jis] || null;
}

// MVP scope: used apartments (chuko mansion) in Chiba.
function buildUrl({ jis, page = 1 }) {
  const slug = citySlugFor(jis);
  const cityPath = slug ? `${slug}/` : '';
  const pagePath = page > 1 ? `page${page}/` : '';
  return `${BASE}/mansion/chuko/chiba/${cityPath}list/${pagePath}`;
}

function matchesLayout(layout, layoutKey) {
  if (!layoutKey || layoutKey === 'any') return true;
  const l = (layout || '').toUpperCase();
  switch (layoutKey) {
    case 'studio': return /1R|1K|1DK/.test(l);
    case '1ldk': return l.includes('1LDK');
    case '2ldk': return l.includes('2LDK');
    case '3ldk': return l.includes('3LDK');
    case '4ldk': {
      const m = l.match(/(\d+)LDK/);
      return m ? parseInt(m[1], 10) >= 4 : false;
    }
    default: return true;
  }
}

function applyFilters(listings, opts = {}) {
  const { minYen, maxYen, layoutKey, walkMax, ageMaxYears, addressContains } = opts;
  return listings.filter((x) => {
    const yen = x.price ? x.price.yen : null;
    if (minYen != null && (yen == null || yen < minYen)) return false;
    if (maxYen != null && (yen == null || yen > maxYen)) return false;
    if (!matchesLayout(x.layout, layoutKey)) return false;
    if (walkMax != null && (x.walkMin == null || x.walkMin > walkMax)) return false;
    if (ageMaxYears != null) {
      const yrs = x.buildingAge ? x.buildingAge.years : null;
      if (yrs == null || yrs > ageMaxYears) return false;
    }
    if (addressContains && (!x.address || !x.address.includes(addressContains))) return false;
    return true;
  });
}

// Fetch up to PAGES_TO_FETCH result pages, parse, then filter in code (AtHome's
// price/layout/walk/age refine controls are not GET-addressable). When a city
// has no AtHome slug we search prefecture-wide and narrow by address text.
async function search(filters) {
  const slug = citySlugFor(filters.jis);
  const addressContains = (!slug && filters.cityJa && filters.jis) ? filters.cityJa : null;
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
        throw new Error('AtHome served an anti-bot challenge page (no listings retrievable)');
      }
      break; // later page blocked: keep what we have
    }
    const parsed = parseListings(html);
    if (parsed.length === 0) break;
    all.push(...parsed);
    if (page < PAGES_TO_FETCH) await sleep(PAGE_DELAY_MS);
  }
  const listings = applyFilters(all, {
    minYen: filters.minYen,
    maxYen: filters.maxYen,
    layoutKey: filters.layoutKey,
    walkMax: filters.walkMax,
    ageMaxYears: filters.ageMaxYears,
    addressContains,
  });
  return { source: 'athome', status: 'ok', count: listings.length, listings, scanned: all.length };
}

module.exports = { source: 'athome', parseListings, buildUrl, citySlugFor, applyFilters, search, looksBlocked };
