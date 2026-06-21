const test = require('node:test');
const assert = require('node:assert');
const { app } = require('../src/server');

test('GET /api/health returns ok', async () => {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body, { ok: true });
  } finally {
    server.close();
  }
});
