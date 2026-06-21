'use strict';

const athome = require('./adapters/athome');
const housedo = require('./adapters/housedo');
const suumo = require('./adapters/suumo');
const { getCached, setCached } = require('./lib/cache');

const CACHE_TTL_MS = 10 * 60 * 1000;

const ADAPTERS = [athome, housedo, suumo];

async function runOne(adapter, filters) {
  const key = adapter.source + ':' + JSON.stringify(filters);
  const cached = getCached(key);
  if (cached) return cached;
  try {
    const portal = await adapter.search(filters);
    setCached(key, portal, CACHE_TTL_MS);
    return portal;
  } catch (err) {
    return {
      source: adapter.source,
      status: 'unavailable',
      error: String(err && err.message ? err.message : err),
      count: 0,
      listings: [],
      scanned: 0,
    };
  }
}

async function runSearch(filters) {
  const portals = await Promise.all(ADAPTERS.map((a) => runOne(a, filters)));
  return { portals };
}

module.exports = { runSearch, ADAPTERS };
