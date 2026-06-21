const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseListings } = require('../src/adapters/athome');

const html = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'athome-chiba-list.html'), 'utf8');

test('parseListings returns several listings', () => {
  const out = parseListings(html);
  assert.ok(out.length >= 10, `expected >=10 listings, got ${out.length}`);
});

test('every listing has source, title, and an AtHome url', () => {
  const out = parseListings(html);
  for (const x of out) {
    assert.strictEqual(x.source, 'athome');
    assert.ok(typeof x.title === 'string' && x.title.length > 0, 'title missing');
    assert.ok(x.url && x.url.startsWith('https://www.athome.co.jp/mansion/'),
      `bad url: ${x.url}`);
    assert.ok(x.price.yen === null || x.price.yen > 0, `bad price: ${x.price.yen}`);
  }
});

test('most listings have a numeric price and a layout', () => {
  const out = parseListings(html);
  const withPrice = out.filter((x) => x.price.yen > 0).length;
  const withLayout = out.filter((x) => x.layout).length;
  assert.ok(withPrice >= out.length * 0.8, `prices ${withPrice}/${out.length}`);
  assert.ok(withLayout >= out.length * 0.8, `layouts ${withLayout}/${out.length}`);
});
