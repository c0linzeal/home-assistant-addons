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

function parseListings(html) {
  const $ = cheerio.load(html);
  const listings = [];

  $('table.bukkendetails').each((_, el) => {
    const card = $(el);

    // Title: link in .bukken-tit header row
    const title = card.find('.bukken-tit a.detailEstate').first().text().trim();

    // Price: span.price contains the number (in 万円); surrounding td has 万円 text
    const priceSpan = card.find('span.price').first().text().trim();
    // Build a parseable string like "2,198万円"
    const priceText = priceSpan ? priceSpan + '万円' : '';

    // Detail fields
    const layoutRaw = readDetail($, card, '間取り');
    const areaRaw = readDetail($, card, '専有面積');
    const ageRaw = readDetail($, card, '築年月');
    const addressRaw = readDetail($, card, '所在地');
    const transitRaw = readDetail($, card, '交通');

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

// HouseDo used-mansion listings for Chiba prefecture.
// Page 1: /used_mansion/千葉県/list/
// Page N: /used_mansion/千葉県/list/?pageNum=N
function buildUrl({ page = 1 } = {}) {
  const base = `${BASE}/used_mansion/%E5%8D%83%E8%91%89%E7%9C%8C/list/`;
  return page > 1 ? `${base}?pageNum=${page}` : base;
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
        throw new Error('HouseDo served a non-listing page (no listings retrievable)');
      }
      break;
    }

    const parsed = parseListings(html);
    if (parsed.length === 0) {
      if (page === 1) {
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
    addressContains: (filters.cityJa && filters.jis) ? filters.cityJa : null,
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
