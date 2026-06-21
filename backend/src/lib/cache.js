'use strict';

const store = new Map();

function getCached(key, now = Date.now()) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expires <= now) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value, ttlMs, now = Date.now()) {
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

function clearCache() {
  store.clear();
}

module.exports = { getCached, setCached, clearCache };
