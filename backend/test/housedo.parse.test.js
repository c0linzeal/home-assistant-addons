'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseListings, buildUrl } = require('../src/adapters/housedo');

// ─── Used-mansion fixture (existing) ───────────────────────────────────────
const mansionHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'housedo-chiba-list.html'), 'utf8');

const mansionListings = parseListings(mansionHtml, 'used_apartment');

test('used_apartment: parseListings returns >= 10 listings', () => {
  assert.ok(mansionListings.length >= 10, `expected >=10 listings, got ${mansionListings.length}`);
});

test('used_apartment: every listing has source housedo, non-empty title, and absolute HouseDo url', () => {
  for (const x of mansionListings) {
    assert.strictEqual(x.source, 'housedo', `source wrong: ${x.source}`);
    assert.ok(typeof x.title === 'string' && x.title.length > 0, `title missing for ${JSON.stringify(x)}`);
    assert.ok(x.url && x.url.startsWith('https://www.housedo.com'),
      `bad url: ${x.url}`);
    assert.ok(x.price.yen === null || x.price.yen > 0, `bad price: ${x.price.yen}`);
  }
});

test('used_apartment: >= 70% of listings have a numeric price', () => {
  const withPrice = mansionListings.filter((x) => x.price.yen != null && x.price.yen > 0).length;
  assert.ok(withPrice >= mansionListings.length * 0.7,
    `prices ${withPrice}/${mansionListings.length} (need >= 70%)`);
});

test('used_apartment: >= 70% of listings have a layout', () => {
  const withLayout = mansionListings.filter((x) => x.layout).length;
  assert.ok(withLayout >= mansionListings.length * 0.7,
    `layouts ${withLayout}/${mansionListings.length} (need >= 70%)`);
});

test('used_apartment: landSqm is null for all mansion listings', () => {
  for (const x of mansionListings) {
    assert.strictEqual(x.landSqm, null, `landSqm should be null for apartments, got ${x.landSqm}`);
  }
});

// ─── Used-house fixture (new) ───────────────────────────────────────────────
const houseHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'housedo-house-list.html'), 'utf8');

const houseListings = parseListings(houseHtml, 'used_house');

test('used_house: parseListings returns >= 10 listings', () => {
  assert.ok(houseListings.length >= 10, `expected >=10 listings, got ${houseListings.length}`);
});

test('used_house: every listing has source housedo, non-empty title, and absolute HouseDo url', () => {
  for (const x of houseListings) {
    assert.strictEqual(x.source, 'housedo', `source wrong: ${x.source}`);
    assert.ok(typeof x.title === 'string' && x.title.length > 0, `title missing for ${JSON.stringify(x)}`);
    assert.ok(x.url && x.url.startsWith('https://www.housedo.com'),
      `bad url: ${x.url}`);
    assert.ok(x.price.yen === null || x.price.yen > 0, `bad price: ${x.price.yen}`);
  }
});

test('used_house: >= 70% of listings have a numeric price', () => {
  const withPrice = houseListings.filter((x) => x.price.yen != null && x.price.yen > 0).length;
  assert.ok(withPrice >= houseListings.length * 0.7,
    `prices ${withPrice}/${houseListings.length} (need >= 70%)`);
});

test('used_house: >= 50% of listings have landSqm populated', () => {
  const withLand = houseListings.filter((x) => x.landSqm != null && x.landSqm > 0).length;
  assert.ok(withLand >= houseListings.length * 0.5,
    `landSqm ${withLand}/${houseListings.length} (need >= 50%)`);
});

// ─── buildUrl path assertions ───────────────────────────────────────────────
test('buildUrl used_apartment uses used_mansion path', () => {
  const url = buildUrl({ propertyType: 'used_apartment' });
  assert.ok(url.includes('/used_mansion/'), `expected /used_mansion/ in ${url}`);
});

test('buildUrl new_apartment uses new_mansion path', () => {
  const url = buildUrl({ propertyType: 'new_apartment' });
  assert.ok(url.includes('/new_mansion/'), `expected /new_mansion/ in ${url}`);
});

test('buildUrl used_house uses used_ikkodate path', () => {
  const url = buildUrl({ propertyType: 'used_house' });
  assert.ok(url.includes('/used_ikkodate/'), `expected /used_ikkodate/ in ${url}`);
});

test('buildUrl new_house uses new_ikkodate path', () => {
  const url = buildUrl({ propertyType: 'new_house' });
  assert.ok(url.includes('/new_ikkodate/'), `expected /new_ikkodate/ in ${url}`);
});

test('buildUrl page 1 has no pageNum param', () => {
  const url = buildUrl({ propertyType: 'used_house', page: 1 });
  assert.ok(!url.includes('pageNum'), `page 1 url should not have pageNum: ${url}`);
});

test('buildUrl page 2 has pageNum=2', () => {
  const url = buildUrl({ propertyType: 'used_house', page: 2 });
  assert.ok(url.includes('pageNum=2'), `page 2 url should have pageNum=2: ${url}`);
});
