'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { parseListings, buildUrl } = require('../src/adapters/homes');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fixturesDir = path.join(__dirname, 'fixtures');

const mansionHtml = fs.readFileSync(path.join(fixturesDir, 'homes-chiba-list.html'), 'utf8');
const houseHtml   = fs.readFileSync(path.join(fixturesDir, 'homes-house-list.html'), 'utf8');
const newHouseHtml     = fs.existsSync(path.join(fixturesDir, 'homes-newhouse-list.html'))
  ? fs.readFileSync(path.join(fixturesDir, 'homes-newhouse-list.html'), 'utf8')
  : null;
const newMansionHtml   = fs.existsSync(path.join(fixturesDir, 'homes-newmansion-list.html'))
  ? fs.readFileSync(path.join(fixturesDir, 'homes-newmansion-list.html'), 'utf8')
  : null;

// ── buildUrl assertions ───────────────────────────────────────────────────────

test('buildUrl: used_apartment defaults', () => {
  assert.strictEqual(
    buildUrl({ propertyType: 'used_apartment' }),
    'https://www.homes.co.jp/mansion/chuko/chiba/list/',
  );
});

test('buildUrl: used_apartment page 2', () => {
  assert.ok(buildUrl({ propertyType: 'used_apartment', page: 2 }).includes('?page=2'));
});

test('buildUrl: new_apartment', () => {
  assert.ok(buildUrl({ propertyType: 'new_apartment' }).includes('/mansion/shinchiku/'));
});

test('buildUrl: used_house', () => {
  assert.ok(buildUrl({ propertyType: 'used_house' }).includes('/kodate/chuko/'));
});

test('buildUrl: new_house', () => {
  assert.ok(buildUrl({ propertyType: 'new_house' }).includes('/kodate/shinchiku/'));
});

test('buildUrl: unknown type falls back to used_apartment path', () => {
  assert.ok(buildUrl({ propertyType: 'unknown' }).includes('/mansion/chuko/'));
});

// ── used_apartment (existing mansion fixture) ─────────────────────────────────

const mansionListings = parseListings(mansionHtml, 'used_apartment');
const $m = cheerio.load(mansionHtml);
const mansionCardCount = $m('div.mod-mergeBuilding--sale').length;

test('used_apartment: returns at least 10 listings (units)', () => {
  assert.ok(mansionListings.length >= 10, `expected >=10 listings, got ${mansionListings.length}`);
});

test('used_apartment: flattening — listings >= building card count', () => {
  assert.ok(
    mansionListings.length >= mansionCardCount,
    `listings (${mansionListings.length}) < buildings (${mansionCardCount})`,
  );
});

test('used_apartment: every listing has source=homes, non-empty title, homes.co.jp url', () => {
  for (const x of mansionListings) {
    assert.strictEqual(x.source, 'homes', `source wrong: ${x.source}`);
    assert.ok(typeof x.title === 'string' && x.title.length > 0, `title missing: ${x.title}`);
    assert.ok(x.url && x.url.startsWith('https://www.homes.co.jp'), `url wrong: ${x.url}`);
    assert.ok(x.price.yen === null || x.price.yen > 0, `bad price.yen: ${x.price.yen}`);
  }
});

test('used_apartment: at least 60% of listings have a numeric price', () => {
  const withPrice = mansionListings.filter((x) => x.price.yen != null && x.price.yen > 0).length;
  assert.ok(
    withPrice >= mansionListings.length * 0.6,
    `price coverage too low: ${withPrice}/${mansionListings.length}`,
  );
});

test('used_apartment: at least 60% of listings have a layout', () => {
  const withLayout = mansionListings.filter((x) => x.layout && x.layout.length > 0).length;
  assert.ok(
    withLayout >= mansionListings.length * 0.6,
    `layout coverage too low: ${withLayout}/${mansionListings.length}`,
  );
});

test('used_apartment: landSqm is null for all apartment listings', () => {
  for (const x of mansionListings) {
    assert.strictEqual(x.landSqm, null, `landSqm should be null for apartment: ${x.landSqm}`);
  }
});

// ── used_house fixture ────────────────────────────────────────────────────────

const houseListings = parseListings(houseHtml, 'used_house');

test('used_house: returns at least 10 listings', () => {
  assert.ok(houseListings.length >= 10, `expected >=10, got ${houseListings.length}`);
});

test('used_house: every listing has source=homes, non-empty title, homes.co.jp url', () => {
  for (const x of houseListings) {
    assert.strictEqual(x.source, 'homes');
    assert.ok(typeof x.title === 'string' && x.title.length > 0, `title missing: ${x.title}`);
    assert.ok(x.url && x.url.startsWith('https://www.homes.co.jp'), `url wrong: ${x.url}`);
  }
});

test('used_house: at least 60% of listings have a numeric price', () => {
  const withPrice = houseListings.filter((x) => x.price.yen != null && x.price.yen > 0).length;
  assert.ok(
    withPrice >= houseListings.length * 0.6,
    `price coverage too low: ${withPrice}/${houseListings.length}`,
  );
});

test('used_house: at least 50% of listings have landSqm populated', () => {
  const withLand = houseListings.filter((x) => x.landSqm != null && x.landSqm > 0).length;
  assert.ok(
    withLand >= houseListings.length * 0.5,
    `landSqm coverage too low: ${withLand}/${houseListings.length}`,
  );
});

test('used_house: at least 50% of listings have areaSqm populated', () => {
  const withArea = houseListings.filter((x) => x.areaSqm != null && x.areaSqm > 0).length;
  assert.ok(
    withArea >= houseListings.length * 0.5,
    `areaSqm coverage too low: ${withArea}/${houseListings.length}`,
  );
});

// ── new_house fixture (flat-table path — no raSpecRow) ────────────────────────

if (newHouseHtml) {
  const newHouseListings = parseListings(newHouseHtml, 'new_house');
  const $nh = cheerio.load(newHouseHtml);
  const newHouseCardCount = $nh('div.mod-mergeBuilding--sale').length;

  test('new_house: flat-table path emits at least one listing per building card', () => {
    assert.ok(
      newHouseListings.length >= 1,
      `expected at least 1 listing, got ${newHouseListings.length}`,
    );
  });

  test('new_house: listings count matches building card count (one per card)', () => {
    assert.strictEqual(
      newHouseListings.length, newHouseCardCount,
      `expected ${newHouseCardCount} listings (one per card), got ${newHouseListings.length}`,
    );
  });

  test('new_house: every listing has source=homes, non-empty title, homes.co.jp url', () => {
    for (const x of newHouseListings) {
      assert.strictEqual(x.source, 'homes');
      assert.ok(typeof x.title === 'string' && x.title.length > 0, `title missing: ${x.title}`);
      assert.ok(x.url && x.url.startsWith('https://www.homes.co.jp'), `url wrong: ${x.url}`);
    }
  });

  test('new_house: at least 60% of listings have a numeric price', () => {
    const withPrice = newHouseListings.filter((x) => x.price.yen != null && x.price.yen > 0).length;
    assert.ok(
      withPrice >= newHouseListings.length * 0.6,
      `price coverage too low: ${withPrice}/${newHouseListings.length}`,
    );
  });

  test('new_house: at least 50% of listings have landSqm populated', () => {
    const withLand = newHouseListings.filter((x) => x.landSqm != null && x.landSqm > 0).length;
    assert.ok(
      withLand >= newHouseListings.length * 0.5,
      `landSqm coverage too low: ${withLand}/${newHouseListings.length}`,
    );
  });
} else {
  test('new_house: fixture not available — skip', () => {
    // intentionally passing; fixture capture is optional
  });
}

// ── new_mansion fixture ───────────────────────────────────────────────────────

if (newMansionHtml) {
  const newMansionListings = parseListings(newMansionHtml, 'new_apartment');
  const $nm = cheerio.load(newMansionHtml);
  const newMansionCardCount = $nm('div.mod-mergeBuilding--sale').length;

  test('new_apartment: returns at least 1 listing', () => {
    assert.ok(
      newMansionListings.length >= 1,
      `expected at least 1, got ${newMansionListings.length}`,
    );
  });

  test('new_apartment: listings count matches building card count (one per card)', () => {
    assert.strictEqual(
      newMansionListings.length, newMansionCardCount,
      `expected ${newMansionCardCount}, got ${newMansionListings.length}`,
    );
  });

  test('new_apartment: every listing has source=homes, title, homes.co.jp url', () => {
    for (const x of newMansionListings) {
      assert.strictEqual(x.source, 'homes');
      assert.ok(typeof x.title === 'string' && x.title.length > 0, `title missing: ${x.title}`);
      assert.ok(x.url && x.url.startsWith('https://www.homes.co.jp'), `url wrong: ${x.url}`);
    }
  });

  test('new_apartment: at least 60% of listings have a numeric price', () => {
    const withPrice = newMansionListings.filter((x) => x.price.yen != null && x.price.yen > 0).length;
    assert.ok(
      withPrice >= newMansionListings.length * 0.6,
      `price coverage too low: ${withPrice}/${newMansionListings.length}`,
    );
  });

  test('new_apartment: landSqm is null for all apartment listings', () => {
    for (const x of newMansionListings) {
      assert.strictEqual(x.landSqm, null, `landSqm should be null: ${x.landSqm}`);
    }
  });
} else {
  test('new_apartment: fixture not available — skip', () => {
    // intentionally passing
  });
}
