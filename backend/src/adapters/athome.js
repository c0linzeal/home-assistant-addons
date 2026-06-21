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

module.exports = { parseListings };
