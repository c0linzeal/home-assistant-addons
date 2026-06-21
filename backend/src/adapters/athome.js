'use strict';

const cheerio = require('cheerio');
const {
  toHalfWidth, parseManYen, parseArea, parseBuildingAgeYears, parseTransit,
} = require('../lib/normalize');

const BASE = 'https://www.athome.co.jp';

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

module.exports = { parseListings, buildUrl, citySlugFor, applyFilters };
