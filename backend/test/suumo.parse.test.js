'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseListings, buildUrl } = require('../src/adapters/suumo');

// ---------------------------------------------------------------------------
// Used apartment (bs=011) — original fixture, must keep passing
// ---------------------------------------------------------------------------
const html = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'suumo-chiba-list.html'), 'utf8');

const listings = parseListings(html, 'used_apartment');

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

test('used_apartment listings have landSqm=null', () => {
  for (const x of listings) {
    assert.strictEqual(x.landSqm, null,
      `used_apartment should have landSqm=null, got ${x.landSqm}`);
  }
});

// ---------------------------------------------------------------------------
// buildUrl: bs= mapping
// ---------------------------------------------------------------------------
test('suumo buildUrl: base, city (sc), pagination', () => {
  const base = buildUrl({ jis: '', page: 1 });
  assert.ok(base.includes('ar=030') && base.includes('bs=011') && base.includes('ta=12'));
  assert.ok(!base.includes('sc=') && !base.includes('page='));
  const city = buildUrl({ jis: '12204', page: 1 });
  assert.ok(city.includes('sc=12204'));
  const p2 = buildUrl({ jis: '', page: 2 });
  assert.ok(p2.includes('page=2'));
});

test('suumo buildUrl: umbrella code 12100 must NOT emit sc=; leaf code 12207 must emit sc=', () => {
  // Chiba City (12100) is an umbrella code — SUUMO sc= doesn't accept it
  assert.ok(!buildUrl({ jis: '12100', page: 1 }).includes('sc='),
    'umbrella code 12100 should not produce sc= param');
  // Chiba City Midori-ku (12207) is a leaf — sc= should be emitted
  assert.ok(buildUrl({ jis: '12207', page: 1 }).includes('sc=12207'),
    'leaf code 12207 should produce sc=12207');
});

test('suumo buildUrl: bs= map for all property types', () => {
  assert.ok(buildUrl({ propertyType: 'used_apartment' }).includes('bs=011'),
    'used_apartment -> bs=011');
  assert.ok(buildUrl({ propertyType: 'new_apartment' }).includes('bs=010'),
    'new_apartment -> bs=010');
  assert.ok(buildUrl({ propertyType: 'used_house' }).includes('bs=021'),
    'used_house -> bs=021');
  assert.ok(buildUrl({ propertyType: 'new_house' }).includes('bs=020'),
    'new_house -> bs=020');
  // default (no propertyType) should be 011
  assert.ok(buildUrl({}).includes('bs=011'), 'default -> bs=011');
});

// ---------------------------------------------------------------------------
// Used house (bs=021)
// ---------------------------------------------------------------------------
const houseHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'suumo-house-list.html'), 'utf8');

const houseListings = parseListings(houseHtml, 'used_house');

test('used_house: parseListings returns at least 10 listings', () => {
  assert.ok(houseListings.length >= 10,
    `expected >=10 house listings, got ${houseListings.length}`);
});

test('used_house: source=suumo, url ok, price ok for >=70%', () => {
  for (const x of houseListings) {
    assert.strictEqual(x.source, 'suumo', `source wrong: ${x.source}`);
    assert.ok(typeof x.title === 'string' && x.title.length > 0, 'title missing');
    assert.ok(x.url && x.url.startsWith('https://suumo.jp'), `url wrong: ${x.url}`);
  }
  const withPrice = houseListings.filter((x) => x.price.yen != null && x.price.yen > 0).length;
  assert.ok(
    withPrice >= houseListings.length * 0.7,
    `house price coverage: ${withPrice}/${houseListings.length}`,
  );
});

test('used_house: at least 50% have landSqm populated', () => {
  const withLand = houseListings.filter((x) => x.landSqm != null && x.landSqm > 0).length;
  assert.ok(
    withLand >= houseListings.length * 0.5,
    `house landSqm coverage too low: ${withLand}/${houseListings.length}`,
  );
});

test('used_house: at least 50% have areaSqm populated (building area)', () => {
  const withArea = houseListings.filter((x) => x.areaSqm != null && x.areaSqm > 0).length;
  assert.ok(
    withArea >= houseListings.length * 0.5,
    `house areaSqm coverage too low: ${withArea}/${houseListings.length}`,
  );
});

// ---------------------------------------------------------------------------
// New mansion (bs=010) — cassette structure
// ---------------------------------------------------------------------------
const newMansionHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'suumo-newmansion-list.html'), 'utf8');

let newMansionListings;
test('new_apartment: parseListings does not throw', () => {
  assert.doesNotThrow(() => {
    newMansionListings = parseListings(newMansionHtml, 'new_apartment');
  });
});

test('new_apartment: returns at least 5 listings with price+title+url', () => {
  // Ensure parsed if the doesNotThrow test ran
  if (!newMansionListings) newMansionListings = parseListings(newMansionHtml, 'new_apartment');
  assert.ok(newMansionListings.length >= 5,
    `expected >=5 new_apartment listings, got ${newMansionListings.length}`);
  for (const x of newMansionListings) {
    assert.strictEqual(x.source, 'suumo', `source wrong: ${x.source}`);
    assert.ok(typeof x.title === 'string' && x.title.length > 0, `title missing`);
    assert.ok(x.url && x.url.startsWith('https://suumo.jp'), `url wrong: ${x.url}`);
  }
});

test('new_apartment: at least 50% have a price raw value', () => {
  if (!newMansionListings) newMansionListings = parseListings(newMansionHtml, 'new_apartment');
  const withPrice = newMansionListings.filter(
    (x) => x.price.raw && x.price.raw.length > 0,
  ).length;
  assert.ok(
    withPrice >= newMansionListings.length * 0.5,
    `new_apartment price.raw coverage: ${withPrice}/${newMansionListings.length}`,
  );
});

test('new_apartment: landSqm is always null (no land area for apartments)', () => {
  if (!newMansionListings) newMansionListings = parseListings(newMansionHtml, 'new_apartment');
  for (const x of newMansionListings) {
    assert.strictEqual(x.landSqm, null, `new_apartment should have landSqm=null`);
  }
});
