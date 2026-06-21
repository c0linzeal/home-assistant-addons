'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { parseListings } = require('../src/adapters/homes');

const html = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'homes-chiba-list.html'), 'utf8');

const listings = parseListings(html);

// Count building cards in fixture for flattening assertion
const $ = cheerio.load(html);
const buildingCount = $('div.mod-mergeBuilding--sale').length;

test('parseListings returns at least 10 listings (units)', () => {
  assert.ok(listings.length >= 10, `expected >=10 listings, got ${listings.length}`);
});

test('flattening: listings >= building card count (units >= buildings)', () => {
  assert.ok(
    listings.length >= buildingCount,
    `expected listings (${listings.length}) >= buildings (${buildingCount})`,
  );
});

test('every listing has source=homes, non-empty title, and a homes.co.jp url', () => {
  for (const x of listings) {
    assert.strictEqual(x.source, 'homes', `source wrong: ${x.source}`);
    assert.ok(typeof x.title === 'string' && x.title.length > 0,
      `title missing or empty: ${JSON.stringify(x.title)}`);
    assert.ok(x.url && x.url.startsWith('https://www.homes.co.jp'),
      `url wrong: ${x.url}`);
    assert.ok(x.price.yen === null || x.price.yen > 0,
      `bad price.yen: ${x.price.yen}`);
  }
});

test('at least 60% of listings have a numeric price', () => {
  const withPrice = listings.filter((x) => x.price.yen != null && x.price.yen > 0).length;
  assert.ok(
    withPrice >= listings.length * 0.6,
    `price coverage too low: ${withPrice}/${listings.length}`,
  );
});

test('at least 60% of listings have a layout', () => {
  const withLayout = listings.filter((x) => x.layout && x.layout.length > 0).length;
  assert.ok(
    withLayout >= listings.length * 0.6,
    `layout coverage too low: ${withLayout}/${listings.length}`,
  );
});
