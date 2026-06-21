'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseListings } = require('../src/adapters/housedo');

const html = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'housedo-chiba-list.html'), 'utf8');

const listings = parseListings(html);

test('parseListings returns >= 10 listings', () => {
  assert.ok(listings.length >= 10, `expected >=10 listings, got ${listings.length}`);
});

test('every listing has source housedo, non-empty title, and absolute HouseDo url', () => {
  for (const x of listings) {
    assert.strictEqual(x.source, 'housedo', `source wrong: ${x.source}`);
    assert.ok(typeof x.title === 'string' && x.title.length > 0, `title missing for ${JSON.stringify(x)}`);
    assert.ok(x.url && x.url.startsWith('https://www.housedo.com'),
      `bad url: ${x.url}`);
    assert.ok(x.price.yen === null || x.price.yen > 0, `bad price: ${x.price.yen}`);
  }
});

test('>= 70% of listings have a numeric price', () => {
  const withPrice = listings.filter((x) => x.price.yen != null && x.price.yen > 0).length;
  assert.ok(withPrice >= listings.length * 0.7,
    `prices ${withPrice}/${listings.length} (need >= 70%)`);
});

test('>= 70% of listings have a layout', () => {
  const withLayout = listings.filter((x) => x.layout).length;
  assert.ok(withLayout >= listings.length * 0.7,
    `layouts ${withLayout}/${listings.length} (need >= 70%)`);
});
