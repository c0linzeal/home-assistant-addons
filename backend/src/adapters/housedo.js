'use strict';

const cheerio = require('cheerio');
const {
  toHalfWidth, parseManYen, parseArea, parseBuildingAgeYears, parseTransit,
} = require('../lib/normalize');
const { fetchHtml } = require('../lib/http');
const { applyFilters } = require('./athome');

const BASE = 'https://www.housedo.com';
const PAGES_TO_FETCH = 3;
const PAGE_DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// URL path prefix per property type
const PATHS = {
  used_apartment: 'used_mansion',
  new_apartment:  'new_mansion',
  used_house:     'used_ikkodate',
  new_house:      'new_ikkodate',
};

// URL-encoded 千葉県
const PREF_ENC = '%E5%8D%83%E8%91%89%E7%9C%8C';

// HouseDo uses table.bukkendetails for each listing card.
// Detail rows use <th>LABEL</th><td>VALUE</td> pairs within <tr>.
// Some rows have multiple th/td pairs in a single row.
function readDetail($, card, label) {
  let value = null;
  card.find('tr').each((_, tr) => {
    $(tr).find('th').each((_, th) => {
      const lbl = toHalfWidth($(th).text().trim());
      if (lbl === label) {
        value = $(th).next('td').text().trim();
        return false; // break inner each
      }
    });
    if (value !== null) return false; // break outer each
  });
  return value;
}

// Parse listings from a HouseDo listing page HTML.
// propertyType: 'used_apartment' | 'new_apartment' | 'used_house' | 'new_house'
function parseListings(html, propertyType = 'used_apartment') {
  const $ = cheerio.load(html);
  const listings = [];
  const isHouse = propertyType === 'used_house' || propertyType === 'new_house';

  $('table.bukkendetails:not([aria-hidden])').each((_, el) => {
    const card = $(el);

    // Title: link in .bukken-tit header row
    const title = card.find('.bukken-tit a.detailEstate').first().text().trim();

    // Price: span.price contains the number (in 万円); surrounding td has 万円 text
    const priceSpan = card.find('span.price').first().text().trim();
    // Build a parseable string like "2,198万円"
    const priceText = priceSpan ? priceSpan + '万円' : '';

    // Detail fields
    const layoutRaw = readDetail($, card, '間取り');
    const ageRaw = readDetail($, card, '築年月');
    const addressRaw = readDetail($, card, '所在地');
    const transitRaw = readDetail($, card, '交通');

    // Area: apartments use 専有面積; houses use 建物面積 (areaSqm) + 土地面積 (landSqm)
    let areaRaw, landRaw;
    if (isHouse) {
      areaRaw = readDetail($, card, '建物面積');
      landRaw = readDetail($, card, '土地面積');
    } else {
      areaRaw = readDetail($, card, '専有面積');
      landRaw = null;
    }

    // Thumbnail: img.estateImageLeft
    const thumbSrc = card.find('img.estateImageLeft').first().attr('src') || null;
    // Skip placeholder/loading images
    const thumbnail = (thumbSrc && !/loading|noimage|no_image/i.test(thumbSrc)) ? thumbSrc : null;

    // Detail URL
    const href = card.find('a.detailEstate').first().attr('href') || null;
    const url = href ? (href.startsWith('http') ? href : BASE + href) : null;

    // Skip placeholder cards (no real title or no real link)
    if (!title || !url) return;

    // Transit
    const transit = transitRaw ? parseTransit(transitRaw) : null;

    listings.push({
      source: 'housedo',
      title: title || null,
      price: { yen: parseManYen(priceText), raw: toHalfWidth(priceText) },
      layout: layoutRaw ? toHalfWidth(layoutRaw) : null,
      areaSqm: areaRaw ? parseArea(areaRaw) : null,
      landSqm: landRaw ? parseArea(landRaw) : null,
      buildingAge: ageRaw ? { raw: ageRaw, years: parseBuildingAgeYears(ageRaw) } : null,
      walkMin: transit ? transit.walkMin : null,
      station: transit ? transit.station : null,
      address: addressRaw ? toHalfWidth(addressRaw) : null,
      thumbnail,
      url,
    });
  });

  return listings;
}

function looksBlocked(html) {
  if (!html) return true;
  if (html.length < 10000 && !/bukkendetails/.test(html)) return true;
  return false;
}

// Build the HouseDo listing URL.
// propertyType maps to a path prefix via PATHS; default used_apartment.
// Page 1: /{prefix}/{pref}/list/
// Page N: /{prefix}/{pref}/list/?pageNum=N
function buildUrl({ propertyType = 'used_apartment', page = 1 } = {}) {
  const prefix = PATHS[propertyType] || PATHS.used_apartment;
  const base = `${BASE}/${prefix}/${PREF_ENC}/list/`;
  return page > 1 ? `${base}?pageNum=${page}` : base;
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
        throw new Error('HouseDo served a non-listing page (no listings retrievable)');
      }
      break;
    }

    const parsed = parseListings(html, propertyType);
    if (parsed.length === 0) {
      // new_apartment may have zero inventory — that's fine, not an error
      if (page === 1 && propertyType !== 'new_apartment') {
        throw new Error('HouseDo returned 0 listings on page 1 (possible structure change)');
      }
      break;
    }

    all.push(...parsed);
    if (page < PAGES_TO_FETCH) await sleep(PAGE_DELAY_MS);
  }

  const listings = applyFilters(all, {
    minYen: filters.minYen,
    maxYen: filters.maxYen,
    layoutKey: filters.layoutKey,
    walkMax: filters.walkMax,
    ageMaxYears: filters.ageMaxYears,
    addressContains: filters.cityJa || null,
  });

  return {
    source: 'housedo',
    status: 'ok',
    count: listings.length,
    listings,
    scanned: all.length,
  };
}

module.exports = { source: 'housedo', parseListings, buildUrl, search };
