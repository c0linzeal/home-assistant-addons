'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { setCached, clearCache } = require('../src/lib/cache');
const { ADAPTERS } = require('../src/search');
const { app } = require('../src/server');

test('GET /api/search?type=used_house uses a distinct cache key from used_apartment', async () => {
  clearCache();

  const houseFilters = {
    jis: '', cityJa: '', minYen: null, maxYen: null,
    layoutKey: 'any', walkMax: null, ageMaxYears: null,
    propertyType: 'used_house',
  };

  // Seed every adapter's cache with house-specific stubs
  for (const adapter of ADAPTERS) {
    const key = adapter.source + ':' + JSON.stringify(houseFilters);
    const stub = {
      source: adapter.source,
      status: 'ok',
      count: 1,
      scanned: 1,
      listings: [{
        source: adapter.source,
        title: `House ${adapter.source}`,
        price: { yen: 2000000, raw: '200万円' },
        layout: '3LDK',
        areaSqm: 90,
        buildingAge: { raw: '', years: 10 },
        walkMin: 8,
        station: 'Y',
        address: '千葉市',
        thumbnail: null,
        url: `https://www.example.com/${adapter.source}/house/1/`,
      }],
    };
    setCached(key, stub, 60000);
  }

  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/search?type=used_house`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.portals.length, ADAPTERS.length,
      `expected ${ADAPTERS.length} portals, got ${body.portals.length}`);

    // Verify the seeded house data came back (not apartment data)
    const athomePortal = body.portals.find((p) => p.source === 'athome');
    assert.ok(athomePortal, 'athome portal missing from response');
    assert.strictEqual(athomePortal.listings[0].title, 'House athome',
      'house search should return house-seeded data, not apartment data');
    assert.strictEqual(athomePortal.listings[0].layout, '3LDK');
  } finally {
    server.close();
    clearCache();
  }
});

test('GET /api/search returns cached portal results for all adapters without network', async () => {
  clearCache();

  const filters = {
    jis: '', cityJa: '', minYen: null, maxYen: null,
    layoutKey: 'any', walkMax: null, ageMaxYears: null,
    propertyType: 'used_apartment',
  };

  // Seed every adapter's cache so no network calls are made
  for (const adapter of ADAPTERS) {
    const key = adapter.source + ':' + JSON.stringify(filters);
    const stub = {
      source: adapter.source,
      status: 'ok',
      count: 1,
      scanned: 1,
      listings: [{
        source: adapter.source,
        title: `Test ${adapter.source}`,
        price: { yen: 1000000, raw: '100万円' },
        layout: '1K',
        areaSqm: 20,
        buildingAge: { raw: '', years: 5 },
        walkMin: 5,
        station: 'X',
        address: '千葉市',
        thumbnail: null,
        url: `https://www.example.com/${adapter.source}/1/`,
      }],
    };
    setCached(key, stub, 60000);
  }

  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/search`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    // Should have one portal per adapter
    assert.strictEqual(body.portals.length, ADAPTERS.length,
      `expected ${ADAPTERS.length} portals, got ${body.portals.length}`);

    // Find and verify the athome portal
    const athomePortal = body.portals.find((p) => p.source === 'athome');
    assert.ok(athomePortal, 'athome portal missing from response');
    assert.strictEqual(athomePortal.count, 1);
    assert.strictEqual(athomePortal.listings[0].title, 'Test athome');

    // Find and verify the housedo portal
    const housedoPortal = body.portals.find((p) => p.source === 'housedo');
    assert.ok(housedoPortal, 'housedo portal missing from response');
    assert.strictEqual(housedoPortal.count, 1);
    assert.strictEqual(housedoPortal.listings[0].title, 'Test housedo');
  } finally {
    server.close();
    clearCache();
  }
});
