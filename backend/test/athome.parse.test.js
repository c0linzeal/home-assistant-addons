const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseListings, buildUrl } = require('../src/adapters/athome');

// ── fixtures ─────────────────────────────────────────────────────────────────

const html = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'athome-chiba-list.html'), 'utf8');

const houseHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'athome-house-list.html'), 'utf8');

const newMansionHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'athome-newmansion-list.html'), 'utf8');

// ── used_apartment (existing) ─────────────────────────────────────────────────

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

test('used_apartment listings have landSqm null', () => {
  for (const x of listings) {
    assert.strictEqual(x.landSqm, null, `expected landSqm null, got ${x.landSqm}`);
  }
});

// ── used_house ────────────────────────────────────────────────────────────────

const houseListings = parseListings(houseHtml, 'used_house');

test('used_house: parseListings returns >=10 listings', () => {
  assert.ok(houseListings.length >= 10, `expected >=10, got ${houseListings.length}`);
});

test('used_house: every listing has source athome and a /kodate/ url', () => {
  for (const x of houseListings) {
    assert.strictEqual(x.source, 'athome');
    assert.ok(x.url && x.url.startsWith('https://www.athome.co.jp/kodate/'),
      `bad url: ${x.url}`);
  }
});

test('used_house: >=70% have a numeric price', () => {
  const withPrice = houseListings.filter((x) => x.price.yen > 0).length;
  assert.ok(withPrice >= houseListings.length * 0.7,
    `prices ${withPrice}/${houseListings.length}`);
});

test('used_house: >=50% have landSqm populated', () => {
  const withLand = houseListings.filter((x) => x.landSqm != null && x.landSqm > 0).length;
  assert.ok(withLand >= houseListings.length * 0.5,
    `landSqm populated ${withLand}/${houseListings.length}`);
});

test('used_house: areaSqm comes from 建物面積 (not 専有面積)', () => {
  // At least some listings should have areaSqm (building area)
  const withArea = houseListings.filter((x) => x.areaSqm != null && x.areaSqm > 0).length;
  assert.ok(withArea >= houseListings.length * 0.5,
    `areaSqm populated ${withArea}/${houseListings.length}`);
});

// ── new_apartment (li.mansion_list_item) ──────────────────────────────────────

const newMansionListings = parseListings(newMansionHtml, 'new_apartment');

test('new_apartment: parseListings returns >=10 listings', () => {
  assert.ok(newMansionListings.length >= 10,
    `expected >=10, got ${newMansionListings.length}`);
});

test('new_apartment: every listing has source athome and /mansion/shinchiku/ url', () => {
  for (const x of newMansionListings) {
    assert.strictEqual(x.source, 'athome');
    assert.ok(x.url && x.url.startsWith('https://www.athome.co.jp/mansion/shinchiku/'),
      `bad url: ${x.url}`);
  }
});

test('new_apartment: >=70% have a numeric price', () => {
  const withPrice = newMansionListings.filter((x) => x.price.yen > 0).length;
  assert.ok(withPrice >= newMansionListings.length * 0.7,
    `prices ${withPrice}/${newMansionListings.length}`);
});

test('new_apartment: landSqm is always null', () => {
  for (const x of newMansionListings) {
    assert.strictEqual(x.landSqm, null);
  }
});

// ── buildUrl path mapping ─────────────────────────────────────────────────────

test('buildUrl: used_apartment path', () => {
  const url = buildUrl({ propertyType: 'used_apartment', page: 1 });
  assert.ok(url.includes('/mansion/chuko/chiba/'), `got: ${url}`);
  assert.ok(!url.includes('page'), `page1 should not have page segment: ${url}`);
});

test('buildUrl: new_apartment path', () => {
  const url = buildUrl({ propertyType: 'new_apartment', page: 1 });
  assert.ok(url.includes('/mansion/shinchiku/chiba/'), `got: ${url}`);
});

test('buildUrl: used_house path', () => {
  const url = buildUrl({ propertyType: 'used_house', page: 1 });
  assert.ok(url.includes('/kodate/chuko/chiba/'), `got: ${url}`);
});

test('buildUrl: new_house path', () => {
  const url = buildUrl({ propertyType: 'new_house', page: 1 });
  assert.ok(url.includes('/kodate/shinchiku/chiba/'), `got: ${url}`);
});

test('buildUrl: page >1 appends pageN segment', () => {
  const url = buildUrl({ propertyType: 'used_apartment', page: 2 });
  assert.ok(url.includes('/list/page2/'), `got: ${url}`);
});

test('buildUrl: city slug inserted when jis known', () => {
  const url = buildUrl({ propertyType: 'used_house', jis: '12204', page: 1 });
  assert.ok(url.includes('/funabashi-city/'), `got: ${url}`);
});

test('buildUrl: no city segment for unknown jis', () => {
  const url = buildUrl({ propertyType: 'used_house', jis: '99999', page: 1 });
  assert.ok(url.includes('/kodate/chuko/chiba/list/'), `got: ${url}`);
  assert.ok(!url.includes('city'), `should have no city slug: ${url}`);
});
