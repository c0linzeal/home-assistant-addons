'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseListings, buildUrl } = require('../src/adapters/suumo');

const html = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'suumo-chiba-list.html'), 'utf8');

const listings = parseListings(html);

test('parseListings returns at least 10 listings', () => {
  assert.ok(listings.length >= 10, `expected >=10 listings, got ${listings.length}`);
});

test('every listing has source=suumo, non-empty title, and a suumo.jp url', () => {
  for (const x of listings) {
    assert.strictEqual(x.source, 'suumo', `source wrong: ${x.source}`);
    assert.ok(typeof x.title === 'string' && x.title.length > 0,
      `title missing or empty: ${JSON.stringify(x.title)}`);
    assert.ok(x.url && x.url.startsWith('https://suumo.jp'),
      `url wrong: ${x.url}`);
    assert.ok(x.price.yen === null || x.price.yen > 0,
      `bad price.yen: ${x.price.yen}`);
  }
});

test('at least 70% of listings have a numeric price', () => {
  const withPrice = listings.filter((x) => x.price.yen != null && x.price.yen > 0).length;
  assert.ok(
    withPrice >= listings.length * 0.7,
    `price coverage too low: ${withPrice}/${listings.length}`,
  );
});

test('at least 70% of listings have a layout', () => {
  const withLayout = listings.filter((x) => x.layout && x.layout.length > 0).length;
  assert.ok(
    withLayout >= listings.length * 0.7,
    `layout coverage too low: ${withLayout}/${listings.length}`,
  );
});

test('suumo buildUrl: base, city (sc), pagination', () => {
  const base = buildUrl({ jis: '', page: 1 });
  assert.ok(base.includes('ar=030') && base.includes('bs=011') && base.includes('ta=12'));
  assert.ok(!base.includes('sc=') && !base.includes('page='));
  const city = buildUrl({ jis: '12204', page: 1 });
  assert.ok(city.includes('sc=12204'));
  const p2 = buildUrl({ jis: '', page: 2 });
  assert.ok(p2.includes('page=2'));
});
