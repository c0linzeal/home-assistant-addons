const test = require('node:test');
const assert = require('node:assert');
const { buildUrl, applyFilters } = require('../src/adapters/athome');

test('buildUrl: prefecture, city, pagination, unmapped fallback', () => {
  assert.strictEqual(buildUrl({ jis: '', page: 1 }),
    'https://www.athome.co.jp/mansion/chuko/chiba/list/');
  assert.strictEqual(buildUrl({ jis: '12204', page: 1 }),
    'https://www.athome.co.jp/mansion/chuko/chiba/funabashi-city/list/');
  assert.strictEqual(buildUrl({ jis: '12204', page: 2 }),
    'https://www.athome.co.jp/mansion/chuko/chiba/funabashi-city/list/page2/');
  assert.strictEqual(buildUrl({ jis: '12100', page: 1 }),
    'https://www.athome.co.jp/mansion/chuko/chiba/list/');
});

test('applyFilters: budget', () => {
  const listings = [
    { price: { yen: 5000000 }, layout: '1K', walkMin: 5, buildingAge: { years: 10 }, address: '船橋市' },
    { price: { yen: 30000000 }, layout: '3LDK', walkMin: 20, buildingAge: { years: 40 }, address: '千葉市' },
  ];
  const out = applyFilters(listings, { maxYen: 10000000 });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].price.yen, 5000000);
});

test('applyFilters: layout, walk, age, address', () => {
  const listings = [
    { price: { yen: 30000000 }, layout: '3LDK', walkMin: 8, buildingAge: { years: 5 }, address: '千葉市美浜区' },
    { price: { yen: 30000000 }, layout: '1K', walkMin: 25, buildingAge: { years: 50 }, address: '船橋市' },
  ];
  assert.strictEqual(applyFilters(listings, { layoutKey: '3ldk' }).length, 1);
  assert.strictEqual(applyFilters(listings, { walkMax: 10 }).length, 1);
  assert.strictEqual(applyFilters(listings, { ageMaxYears: 20 }).length, 1);
  assert.strictEqual(applyFilters(listings, { addressContains: '船橋' }).length, 1);
});
