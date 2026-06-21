const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseListings } = require('../src/adapters/athome');

const html = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'athome-chiba-list.html'), 'utf8');

const listings = parseListings(html);

test('parseListings returns several listings', () => {
  assert.ok(listings.length >= 10, `expected >=10 listings, got ${listings.length}`);
});

test('every listing has source, title, and an AtHome url', () => {
  for (const x of listings) {
    assert.strictEqual(x.source, 'athome');
    assert.ok(typeof x.title === 'string' && x.title.length > 0, 'title missing');
    assert.ok(x.url && x.url.startsWith('https://www.athome.co.jp/mansion/'),
      `bad url: ${x.url}`);
    assert.ok(x.price.yen === null || x.price.yen > 0, `bad price: ${x.price.yen}`);
  }
});

test('most listings have a numeric price and a layout', () => {
  const withPrice = listings.filter((x) => x.price.yen > 0).length;
  const withLayout = listings.filter((x) => x.layout).length;
  assert.ok(withPrice >= listings.length * 0.8, `prices ${withPrice}/${listings.length}`);
  assert.ok(withLayout >= listings.length * 0.8, `layouts ${withLayout}/${listings.length}`);
});

test('titles are the property name only (no price text)', () => {
  for (const x of listings) {
    assert.ok(!/万円|億/.test(x.title), `title contains price: ${x.title}`);
    assert.ok(!/\n/.test(x.title), `title has newline: ${JSON.stringify(x.title)}`);
    assert.ok(x.title.length > 0, 'empty title');
  }
});
