'use strict';
const athome = require('./adapters/athome');
const { getCached, setCached } = require('./lib/cache');

const CACHE_TTL_MS = 10 * 60 * 1000;

function cacheKey(filters) {
  return 'athome:' + JSON.stringify(filters);
}

async function runSearch(filters) {
  const key = cacheKey(filters);
  const cached = getCached(key);
  if (cached) return { portals: [cached], cached: true };

  let portal;
  try {
    portal = await athome.search(filters);
    setCached(key, portal, CACHE_TTL_MS);
  } catch (err) {
    portal = {
      source: 'athome', status: 'unavailable',
      error: String(err && err.message ? err.message : err),
      count: 0, listings: [], scanned: 0,
    };
  }
  return { portals: [portal], cached: false };
}

module.exports = { runSearch };
