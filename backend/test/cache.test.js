const test = require('node:test');
const assert = require('node:assert');
const { getCached, setCached, clearCache } = require('../src/lib/cache');

test('cache set/get/miss/expiry with injectable clock', () => {
  clearCache();
  setCached('k', { a: 1 }, 1000, 1000);
  assert.deepStrictEqual(getCached('k', 1500), { a: 1 });
  assert.strictEqual(getCached('k', 2500), null);
  assert.strictEqual(getCached('missing', 1000), null);
});
