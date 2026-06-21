const test = require('node:test');
const assert = require('node:assert');
const { setCached, clearCache } = require('../src/lib/cache');
const { app } = require('../src/server');

test('GET /api/search returns cached portal result without network', async () => {
  clearCache();
  const filters = {
    jis: '', cityJa: '', minYen: null, maxYen: null,
    layoutKey: 'any', walkMax: null, ageMaxYears: null,
  };
  const seeded = {
    source: 'athome', status: 'ok', count: 1, scanned: 1,
    listings: [{ source: 'athome', title: 'Test', price: { yen: 1000000, raw: '100万円' },
      layout: '1K', areaSqm: 20, buildingAge: { raw: '', years: 5 }, walkMin: 5,
      station: 'X', address: '千葉市', thumbnail: null, url: 'https://www.athome.co.jp/mansion/1/' }],
  };
  setCached('athome:' + JSON.stringify(filters), seeded, 60000);

  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/search`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.cached, true);
    assert.strictEqual(body.portals[0].count, 1);
    assert.strictEqual(body.portals[0].listings[0].title, 'Test');
  } finally {
    server.close();
    clearCache();
  }
});
