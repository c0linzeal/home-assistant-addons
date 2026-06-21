'use strict';
const express = require('express');
const { runSearch } = require('./search');

const app = express();

app.get('/api/health', (req, res) => res.json({ ok: true }));

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

app.get('/api/search', async (req, res) => {
  const q = req.query;
  const filters = {
    jis: typeof q.jis === 'string' ? q.jis : '',
    cityJa: typeof q.cityJa === 'string' ? q.cityJa : '',
    minYen: toNum(q.minYen),
    maxYen: toNum(q.maxYen),
    layoutKey: typeof q.layout === 'string' ? q.layout : 'any',
    walkMax: toNum(q.walk),
    ageMaxYears: toNum(q.age),
    propertyType: typeof q.type === 'string' && q.type ? q.type : 'used_apartment',
  };
  try {
    const result = await runSearch(filters);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`backend listening on ${PORT}`));
}

module.exports = { app };
