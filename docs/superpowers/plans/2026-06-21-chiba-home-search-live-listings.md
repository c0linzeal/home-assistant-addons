# Chiba Home Search — Live Listings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live, in-app listings to the `chiba-home-search` static tool by introducing a small Node backend that scrapes AtHome (Phase 0), behind the existing nginx container on port 8096.

**Architecture:** Two-container Docker Compose stack behind one origin. nginx serves the existing static site and reverse-proxies `/api/` to a Node+Express backend. The backend fetches AtHome's server-rendered results pages, parses them with cheerio, applies budget/layout/walk/age filters in code (those filters are not GET-able on AtHome), and returns normalized JSON. The frontend calls `/api/search` and renders listing cards alongside the existing click-out links.

**Tech Stack:** Node 20 (CommonJS), Express 4, cheerio 1.x, Node built-in test runner (`node --test`). nginx:alpine. No headless browser.

## Global Constraints

- Public origin stays on host port **8096** (8095 is taken by another container). Do not change the host port.
- Backend listens internally on port **3000**, exposed only to the compose network (no host port).
- Runtime dependencies limited to **express** and **cheerio**. Tests use the **built-in** `node:test`/`node:assert` only — no test framework dependency.
- Scraping must stay polite: realistic User-Agent, `Accept-Language: ja,en;q=0.8`, ~12s per-request timeout, sequential page fetches with a delay, and a ~10-minute in-memory result cache. No headless browser (spike confirmed AtHome is server-rendered).
- All containers use `restart: unless-stopped` so they survive reboot.
- Phase 0 covers **AtHome + used apartments (中古マンション) only**. SUUMO/HOME'S/HouseDo and other property types are explicit follow-on plans.
- Repo: `/home/colin/projects/home-assistant-addons`, branch `claude/chiba-home-search-tool-mmm1u4`. Commit after each task. Do not push. End every commit message with the trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Backend scaffold + health endpoint

**Files:**
- Create: `backend/package.json`
- Create: `backend/src/server.js`
- Create: `backend/.gitignore`
- Test: `backend/test/server.test.js`

**Interfaces:**
- Produces: `backend/src/server.js` exports `{ app }` (an Express app). `GET /api/health` → `200 {"ok":true}`.

- [ ] **Step 1: Create `backend/.gitignore`**

```
node_modules
npm-debug.log
*.log
```

- [ ] **Step 2: Create `backend/package.json`**

```json
{
  "name": "chiba-home-search-api",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^4.19.2",
    "cheerio": "^1.0.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd /home/colin/projects/home-assistant-addons/backend && npm install`
Expected: creates `node_modules/` and `package-lock.json`, no errors.

- [ ] **Step 4: Write the failing test `backend/test/server.test.js`**

```js
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
```

- [ ] **Step 5: Run the test, verify it fails**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test`
Expected: FAIL — cannot find module `../src/server`.

- [ ] **Step 6: Write minimal `backend/src/server.js`**

```js
'use strict';
const express = require('express');

const app = express();

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`backend listening on ${PORT}`));
}

module.exports = { app };
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test`
Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
cd /home/colin/projects/home-assistant-addons
git add backend/.gitignore backend/package.json backend/package-lock.json backend/src/server.js backend/test/server.test.js
git commit -m "feat(api): scaffold Express backend with health endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Normalization helpers

**Files:**
- Create: `backend/src/lib/normalize.js`
- Test: `backend/test/normalize.test.js`

**Interfaces:**
- Produces: `normalize.js` exports `{ toHalfWidth, parseManYen, parseArea, parseBuildingAgeYears, parseTransit }`.
  - `toHalfWidth(str): string` — NFKC-normalize + trim (full-width → half-width).
  - `parseManYen(text): number|null` — AtHome price text (万円/億 units) → integer yen.
  - `parseArea(text): number|null` — "26.62m²" → 26.62.
  - `parseBuildingAgeYears(text): number|null` — "…（築43年…）" → 43; "新築" → 0.
  - `parseTransit(text): { raw, line, station, walkMin }`.

- [ ] **Step 1: Write the failing test `backend/test/normalize.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert');
const {
  toHalfWidth, parseManYen, parseArea, parseBuildingAgeYears, parseTransit,
} = require('../src/lib/normalize');

test('toHalfWidth converts zenkaku to hankaku', () => {
  assert.strictEqual(toHalfWidth('１ＬＤＫ'), '1LDK');
  assert.strictEqual(toHalfWidth('ＳＲＣ'), 'SRC');
});

test('parseManYen handles man and oku', () => {
  assert.strictEqual(parseManYen('80万円'), 800000);
  assert.strictEqual(parseManYen('2,980万円'), 29800000);
  assert.strictEqual(parseManYen('1億2,980万円'), 129800000);
  assert.strictEqual(parseManYen('1億円'), 100000000);
  assert.strictEqual(parseManYen(''), null);
});

test('parseArea parses sqm', () => {
  assert.strictEqual(parseArea('26.62m²'), 26.62);
  assert.strictEqual(parseArea('ＳＲＣ'), null);
});

test('parseBuildingAgeYears extracts years', () => {
  assert.strictEqual(parseBuildingAgeYears('1983年4月（築43年3ヶ月）'), 43);
  assert.strictEqual(parseBuildingAgeYears('新築'), 0);
  assert.strictEqual(parseBuildingAgeYears('—'), null);
});

test('parseTransit extracts station and walk', () => {
  const t = parseTransit('ＪＲ総武線 「西船橋」駅 徒歩8分');
  assert.strictEqual(t.station, '西船橋');
  assert.strictEqual(t.walkMin, 8);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test test/normalize.test.js`
Expected: FAIL — cannot find module `../src/lib/normalize`.

- [ ] **Step 3: Write `backend/src/lib/normalize.js`**

```js
'use strict';

// NFKC folds full-width (zenkaku) letters/digits to half-width.
function toHalfWidth(str) {
  if (str == null) return '';
  return String(str).normalize('NFKC').trim();
}

// AtHome prices are in 万円 (man-yen) units, optionally with 億 (oku = 10,000万).
// "80万円" -> 800000, "2,980万円" -> 29800000, "1億2,980万円" -> 129800000.
function parseManYen(text) {
  const s = toHalfWidth(text).replace(/,/g, '');
  if (!s) return null;
  let oku = 0;
  let man = 0;
  const okuMatch = s.match(/([\d.]+)億/);
  if (okuMatch) oku = parseFloat(okuMatch[1]);
  const manMatch = s.match(/(?:億)?([\d.]+)万/);
  if (manMatch) {
    man = parseFloat(manMatch[1]);
  } else if (!okuMatch) {
    const bare = s.match(/([\d.]+)/);
    if (bare) man = parseFloat(bare[1]);
  }
  const yen = Math.round((oku * 10000 + man) * 10000);
  return yen > 0 ? yen : null;
}

function parseArea(text) {
  const s = toHalfWidth(text);
  const m = s.match(/([\d.]+)\s*m/i);
  return m ? parseFloat(m[1]) : null;
}

function parseBuildingAgeYears(text) {
  const s = toHalfWidth(text);
  const m = s.match(/築\s*(\d+)\s*年/);
  if (m) return parseInt(m[1], 10);
  if (/新築/.test(s)) return 0;
  return null;
}

function parseTransit(text) {
  const s = toHalfWidth(text);
  const stationM = s.match(/「([^」]+)」/);
  const walkM = s.match(/徒歩\s*(\d+)\s*分/);
  const lineM = s.match(/^([^「]+?)\s*「/);
  return {
    raw: s,
    line: lineM ? lineM[1].trim() : null,
    station: stationM ? stationM[1] : null,
    walkMin: walkM ? parseInt(walkM[1], 10) : null,
  };
}

module.exports = { toHalfWidth, parseManYen, parseArea, parseBuildingAgeYears, parseTransit };
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test test/normalize.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/colin/projects/home-assistant-addons
git add backend/src/lib/normalize.js backend/test/normalize.test.js
git commit -m "feat(api): add price/area/age/transit normalization helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: HTTP fetch wrapper + in-memory TTL cache

**Files:**
- Create: `backend/src/lib/http.js`
- Create: `backend/src/lib/cache.js`
- Test: `backend/test/cache.test.js`

**Interfaces:**
- Produces: `http.js` exports `{ fetchHtml, DEFAULT_UA }`. `fetchHtml(url, { timeoutMs = 12000 }): Promise<string>` — GET with polite headers; throws on non-2xx or timeout.
- Produces: `cache.js` exports `{ getCached, setCached, clearCache }`.
  - `getCached(key, now = Date.now()): any|null`
  - `setCached(key, value, ttlMs, now = Date.now()): value`
  - `clearCache(): void`

- [ ] **Step 1: Write `backend/src/lib/http.js`**

```js
'use strict';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchHtml(url, { timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': DEFAULT_UA,
        'Accept-Language': 'ja,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchHtml, DEFAULT_UA };
```

- [ ] **Step 2: Write the failing test `backend/test/cache.test.js`**

```js
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
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test test/cache.test.js`
Expected: FAIL — cannot find module `../src/lib/cache`.

- [ ] **Step 4: Write `backend/src/lib/cache.js`**

```js
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
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test test/cache.test.js`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
cd /home/colin/projects/home-assistant-addons
git add backend/src/lib/http.js backend/src/lib/cache.js backend/test/cache.test.js
git commit -m "feat(api): add polite HTTP fetch wrapper and TTL cache

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: AtHome adapter — parse a captured fixture

**Files:**
- Create: `backend/test/fixtures/athome-chiba-list.html` (captured real HTML)
- Create: `backend/src/adapters/athome.js` (this task adds `parseListings`)
- Test: `backend/test/athome.parse.test.js`

**Interfaces:**
- Produces: `athome.js` exports (so far) `{ parseListings }`. `parseListings(html): Array<Listing>` where Listing =
  `{ source:'athome', title, price:{yen:number|null, raw:string}, layout:string|null, areaSqm:number|null, buildingAge:{raw,years}|null, walkMin:number|null, station:string|null, address:string|null, thumbnail:string|null, url:string|null }`.

- [ ] **Step 1: Capture the fixture HTML (real AtHome page)**

Run:
```bash
mkdir -p /home/colin/projects/home-assistant-addons/backend/test/fixtures
curl -sS -L \
  -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" \
  -H "Accept-Language: ja,en;q=0.8" --compressed --max-time 25 \
  -o /home/colin/projects/home-assistant-addons/backend/test/fixtures/athome-chiba-list.html \
  "https://www.athome.co.jp/mansion/chuko/chiba/list/"
```
Expected: a file of ~1MB. Sanity-check: `grep -c 'card-box open' backend/test/fixtures/athome-chiba-list.html` should print a number ≥ 10 (≈30). If it prints 0, the markup changed — STOP and re-derive the card selector before continuing.

- [ ] **Step 2: Write the failing test `backend/test/athome.parse.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseListings } = require('../src/adapters/athome');

const html = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'athome-chiba-list.html'), 'utf8');

test('parseListings returns several listings', () => {
  const out = parseListings(html);
  assert.ok(out.length >= 10, `expected >=10 listings, got ${out.length}`);
});

test('every listing has source, title, and an AtHome url', () => {
  const out = parseListings(html);
  for (const x of out) {
    assert.strictEqual(x.source, 'athome');
    assert.ok(typeof x.title === 'string' && x.title.length > 0, 'title missing');
    assert.ok(x.url && x.url.startsWith('https://www.athome.co.jp/mansion/'),
      `bad url: ${x.url}`);
    assert.ok(x.price.yen === null || x.price.yen > 0, `bad price: ${x.price.yen}`);
  }
});

test('most listings have a numeric price and a layout', () => {
  const out = parseListings(html);
  const withPrice = out.filter((x) => x.price.yen > 0).length;
  const withLayout = out.filter((x) => x.layout).length;
  assert.ok(withPrice >= out.length * 0.8, `prices ${withPrice}/${out.length}`);
  assert.ok(withLayout >= out.length * 0.8, `layouts ${withLayout}/${out.length}`);
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test test/athome.parse.test.js`
Expected: FAIL — cannot find module `../src/adapters/athome`.

- [ ] **Step 4: Write `backend/src/adapters/athome.js` (parsing portion)**

```js
'use strict';

const cheerio = require('cheerio');
const {
  toHalfWidth, parseManYen, parseArea, parseBuildingAgeYears, parseTransit,
} = require('../lib/normalize');

const BASE = 'https://www.athome.co.jp';

// AtHome detail rows are label-keyed: <strong>LABEL</strong><span>VALUE</span>.
// Match by label text, not position (row count varies per card).
function readDetail($, card, label) {
  let value = null;
  card.find('.property-detail-table__block').each((_, el) => {
    const strong = toHalfWidth($(el).find('strong').first().text());
    if (strong === label) {
      value = $(el).find('span').first().text().trim();
      return false;
    }
  });
  return value;
}

function pickThumbnail($, card) {
  let thumb = null;
  card.find('li.swiper-slide.bukken-item img').each((_, img) => {
    const src = $(img).attr('src');
    if (src && !/loading_g/.test(src)) { thumb = src; return false; }
  });
  return thumb;
}

function parseListings(html) {
  const $ = cheerio.load(html);
  const listings = [];
  $('div.card-box.open').each((_, el) => {
    const card = $(el);
    const priceText = card.find('.property-price').first().text();
    const layoutRaw = readDetail($, card, '間取り');
    const areaRaw = readDetail($, card, '専有面積');
    const ageRaw = readDetail($, card, '築年月');
    const addressRaw = readDetail($, card, '所在地');
    const transitRaw = readDetail($, card, '交通');

    const title = card.find('.card-box-inner__head .title-wrap__title-text')
      .first().text().trim();

    const href = card.find('a.select-link').first().attr('href')
      || card.find('.card-box-open > a').first().attr('href');
    const url = href ? (href.startsWith('http') ? href : BASE + href) : null;

    const transit = transitRaw ? parseTransit(transitRaw) : null;

    listings.push({
      source: 'athome',
      title,
      price: { yen: parseManYen(priceText), raw: toHalfWidth(priceText) },
      layout: layoutRaw ? toHalfWidth(layoutRaw) : null,
      areaSqm: areaRaw ? parseArea(areaRaw) : null,
      buildingAge: ageRaw ? { raw: ageRaw, years: parseBuildingAgeYears(ageRaw) } : null,
      walkMin: transit ? transit.walkMin : null,
      station: transit ? transit.station : null,
      address: addressRaw ? toHalfWidth(addressRaw) : null,
      thumbnail: pickThumbnail($, card),
      url,
    });
  });
  return listings;
}

module.exports = { parseListings };
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test test/athome.parse.test.js`
Expected: PASS (3 tests). If the 0.8 thresholds fail, inspect a card in the fixture and fix the selector — do not lower the threshold.

- [ ] **Step 6: Commit**

```bash
cd /home/colin/projects/home-assistant-addons
git add backend/src/adapters/athome.js backend/test/athome.parse.test.js backend/test/fixtures/athome-chiba-list.html
git commit -m "feat(api): parse AtHome listing cards from fixture

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: AtHome adapter — URL builder + in-code filters

**Files:**
- Modify: `backend/src/adapters/athome.js` (add `buildUrl`, `citySlugFor`, `applyFilters`, extend exports)
- Test: `backend/test/athome.filter.test.js`

**Interfaces:**
- Produces (added to `athome.js` exports): `{ buildUrl, citySlugFor, applyFilters }`.
  - `citySlugFor(jis: string): string|null` — JIS municipality code → AtHome city slug, or null (prefecture-wide).
  - `buildUrl({ jis, page = 1 }): string` — used-apartment Chiba list URL.
  - `applyFilters(listings, { minYen, maxYen, layoutKey, walkMax, ageMaxYears, addressContains }): Array<Listing>`.

- [ ] **Step 1: Write the failing test `backend/test/athome.filter.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert');
const { buildUrl, applyFilters } = require('../src/adapters/athome');

test('buildUrl: prefecture, city, pagination, unmapped fallback', () => {
  assert.strictEqual(buildUrl({ jis: '', page: 1 }),
    'https://www.athome.co.jp/mansion/chuko/chiba/list/');
  assert.strictEqual(buildUrl({ jis: '12204', page: 1 }),
    'https://www.athome.co.jp/mansion/chuko/chiba/funabashi-city/list/');
  assert.strictEqual(buildUrl({ jis: '12204', page: 2 }),
    'https://www.athome.co.jp/mansion/chuko/chiba/funabashi-city/list/page2/');
  assert.strictEqual(buildUrl({ jis: '12100', page: 1 }),
    'https://www.athome.co.jp/mansion/chuko/chiba/list/');
});

test('applyFilters: budget', () => {
  const listings = [
    { price: { yen: 5000000 }, layout: '1K', walkMin: 5, buildingAge: { years: 10 }, address: '船橋市' },
    { price: { yen: 30000000 }, layout: '3LDK', walkMin: 20, buildingAge: { years: 40 }, address: '千葉市' },
  ];
  const out = applyFilters(listings, { maxYen: 10000000 });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].price.yen, 5000000);
});

test('applyFilters: layout, walk, age, address', () => {
  const listings = [
    { price: { yen: 30000000 }, layout: '3LDK', walkMin: 8, buildingAge: { years: 5 }, address: '千葉市美浜区' },
    { price: { yen: 30000000 }, layout: '1K', walkMin: 25, buildingAge: { years: 50 }, address: '船橋市' },
  ];
  assert.strictEqual(applyFilters(listings, { layoutKey: '3ldk' }).length, 1);
  assert.strictEqual(applyFilters(listings, { walkMax: 10 }).length, 1);
  assert.strictEqual(applyFilters(listings, { ageMaxYears: 20 }).length, 1);
  assert.strictEqual(applyFilters(listings, { addressContains: '船橋' }).length, 1);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test test/athome.filter.test.js`
Expected: FAIL — `buildUrl is not a function` (not yet exported).

- [ ] **Step 3: Add the code to `backend/src/adapters/athome.js`**

Insert the following ABOVE the existing `module.exports` line:

```js
// JIS municipality code -> AtHome city slug. Only slugs confirmed present on
// AtHome are mapped; everything else (incl. ward-split Chiba City 12100) falls
// back to prefecture-wide so we never request a 404 path.
const CITY_SLUGS = {
  '12204': 'funabashi-city',
  '12203': 'ichikawa-city',
  '12207': 'matsudo-city',
  '12217': 'kashiwa-city',
  '12219': 'ichihara-city',
  '12206': 'kisarazu-city',
  '12220': 'nagareyama-city',
  '12224': 'kamagaya-city',
  '12231': 'inzai-city',
  '12210': 'mobara-city',
  '12202': 'choshi-city',
  '12225': 'kimitsu-city',
  '12222': 'abiko-city',
};

function citySlugFor(jis) {
  return CITY_SLUGS[jis] || null;
}

// MVP scope: used apartments (chuko mansion) in Chiba.
function buildUrl({ jis, page = 1 }) {
  const slug = citySlugFor(jis);
  const cityPath = slug ? `${slug}/` : '';
  const pagePath = page > 1 ? `page${page}/` : '';
  return `${BASE}/mansion/chuko/chiba/${cityPath}list/${pagePath}`;
}

function matchesLayout(layout, layoutKey) {
  if (!layoutKey || layoutKey === 'any') return true;
  const l = (layout || '').toUpperCase();
  switch (layoutKey) {
    case 'studio': return /1R|1K|1DK/.test(l);
    case '1ldk': return l.includes('1LDK');
    case '2ldk': return l.includes('2LDK');
    case '3ldk': return l.includes('3LDK');
    case '4ldk': {
      const m = l.match(/(\d+)LDK/);
      return m ? parseInt(m[1], 10) >= 4 : false;
    }
    default: return true;
  }
}

function applyFilters(listings, opts = {}) {
  const { minYen, maxYen, layoutKey, walkMax, ageMaxYears, addressContains } = opts;
  return listings.filter((x) => {
    const yen = x.price ? x.price.yen : null;
    if (minYen != null && (yen == null || yen < minYen)) return false;
    if (maxYen != null && (yen == null || yen > maxYen)) return false;
    if (!matchesLayout(x.layout, layoutKey)) return false;
    if (walkMax != null && (x.walkMin == null || x.walkMin > walkMax)) return false;
    if (ageMaxYears != null) {
      const yrs = x.buildingAge ? x.buildingAge.years : null;
      if (yrs == null || yrs > ageMaxYears) return false;
    }
    if (addressContains && (!x.address || !x.address.includes(addressContains))) return false;
    return true;
  });
}
```

Then update the exports line to:

```js
module.exports = { parseListings, buildUrl, citySlugFor, applyFilters };
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test test/athome.filter.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/colin/projects/home-assistant-addons
git add backend/src/adapters/athome.js backend/test/athome.filter.test.js
git commit -m "feat(api): add AtHome URL builder and in-code filters

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: AtHome search orchestration + /api/search route

**Files:**
- Modify: `backend/src/adapters/athome.js` (add async `search`)
- Create: `backend/src/search.js`
- Modify: `backend/src/server.js` (add `/api/search`)
- Test: `backend/test/search.route.test.js`

**Interfaces:**
- Produces: `athome.js` adds `search(filters): Promise<{source, status, count, listings, scanned}>`. `filters` = `{ jis, cityJa, minYen, maxYen, layoutKey, walkMax, ageMaxYears }`.
- Produces: `search.js` exports `{ runSearch }`. `runSearch(filters): Promise<{ portals: [...], cached: boolean }>`.
- Produces: `server.js` adds `GET /api/search` mapping query params → filters → `runSearch`.

- [ ] **Step 1: Add `search` to `backend/src/adapters/athome.js`**

Add this `require` near the top (below the existing normalize require):

```js
const { fetchHtml } = require('../lib/http');
```

Add these constants below `const BASE = ...`:

```js
const PAGES_TO_FETCH = 3;
const PAGE_DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
```

Add this function above `module.exports`:

```js
// Fetch up to PAGES_TO_FETCH result pages, parse, then filter in code (AtHome's
// price/layout/walk/age refine controls are not GET-addressable). When a city
// has no AtHome slug we search prefecture-wide and narrow by address text.
async function search(filters) {
  const slug = citySlugFor(filters.jis);
  const addressContains = (!slug && filters.cityJa && filters.jis) ? filters.cityJa : null;
  const all = [];
  for (let page = 1; page <= PAGES_TO_FETCH; page++) {
    const url = buildUrl({ jis: filters.jis, page });
    let html;
    try {
      html = await fetchHtml(url, { timeoutMs: 12000 });
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
    const parsed = parseListings(html);
    if (parsed.length === 0) break;
    all.push(...parsed);
    if (page < PAGES_TO_FETCH) await sleep(PAGE_DELAY_MS);
  }
  const listings = applyFilters(all, {
    minYen: filters.minYen,
    maxYen: filters.maxYen,
    layoutKey: filters.layoutKey,
    walkMax: filters.walkMax,
    ageMaxYears: filters.ageMaxYears,
    addressContains,
  });
  return { source: 'athome', status: 'ok', count: listings.length, listings, scanned: all.length };
}
```

Update exports to:

```js
module.exports = { parseListings, buildUrl, citySlugFor, applyFilters, search };
```

- [ ] **Step 2: Create `backend/src/search.js`**

```js
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
```

- [ ] **Step 3: Add the `/api/search` route to `backend/src/server.js`**

Replace the file contents with:

```js
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
```

- [ ] **Step 4: Write the test `backend/test/search.route.test.js`**

This test must NOT hit the network. It stubs the AtHome fetch by pre-seeding the cache so `runSearch` returns without calling `athome.search`.

```js
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
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test test/search.route.test.js`
Expected: PASS (1 test).

- [ ] **Step 6: Run the FULL suite, verify everything passes**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test`
Expected: PASS (all tests across all files).

- [ ] **Step 7: Optional live smoke test (manual, network-dependent — not part of the suite)**

Run:
```bash
cd /home/colin/projects/home-assistant-addons/backend
node -e "require('./src/adapters/athome').search({jis:'',cityJa:'',maxYen:30000000}).then(r=>console.log(r.status, r.count, 'of', r.scanned, r.listings[0]&&r.listings[0].title))"
```
Expected: prints `ok <n> of <m> <some Japanese title>`. If it errors or prints 0 of 0, AtHome may have changed or rate-limited — note it, but this does not block the commit.

- [ ] **Step 8: Commit**

```bash
cd /home/colin/projects/home-assistant-addons
git add backend/src/adapters/athome.js backend/src/search.js backend/src/server.js backend/test/search.route.test.js
git commit -m "feat(api): add AtHome search orchestration and /api/search route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Dockerize backend + nginx reverse proxy + compose

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`
- Create: `chiba-home-search-deploy/nginx.conf`
- Modify: `chiba-home-search-deploy/compose.yaml`

**Interfaces:**
- Produces: a two-service compose stack on host port 8096; `/api/` proxied to the backend service `chiba-home-search-api:3000`.

- [ ] **Step 1: Create `backend/Dockerfile`**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY src ./src
EXPOSE 3000
CMD ["node", "src/server.js"]
```

- [ ] **Step 2: Create `backend/.dockerignore`**

```
node_modules
test
*.log
```

- [ ] **Step 3: Create `chiba-home-search-deploy/nginx.conf`**

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://chiba-home-search-api:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 60s;
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
```

- [ ] **Step 4: Overwrite `chiba-home-search-deploy/compose.yaml`**

```yaml
services:
  chiba-home-search:
    image: nginx:alpine
    container_name: chiba-home-search
    restart: unless-stopped
    ports:
      - "8096:80"
    volumes:
      - /home/colin/projects/home-assistant-addons/chiba-home-search:/usr/share/nginx/html:ro
      - /home/colin/projects/home-assistant-addons/chiba-home-search-deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - chiba-home-search-api

  chiba-home-search-api:
    build: /home/colin/projects/home-assistant-addons/backend
    container_name: chiba-home-search-api
    restart: unless-stopped
    expose:
      - "3000"
```

- [ ] **Step 5: Build and start the stack**

Run:
```bash
docker compose -f /home/colin/projects/home-assistant-addons/chiba-home-search-deploy/compose.yaml up -d --build
```
Expected: both `chiba-home-search` and `chiba-home-search-api` containers built and running. Verify: `docker ps --filter name=chiba-home-search` shows both Up, host mapping `0.0.0.0:8096->80/tcp` on the nginx one.

- [ ] **Step 6: Verify the API through nginx**

Run: `curl -sS http://localhost:8096/api/health`
Expected: `{"ok":true}`

Run: `curl -sS "http://localhost:8096/api/search?maxYen=30000000" | head -c 400`
Expected: JSON beginning `{"portals":[{"source":"athome","status":"ok",...` with a non-zero `count`. (If `status":"unavailable"`, check `docker logs chiba-home-search-api`.)

- [ ] **Step 7: Verify the static site still serves**

Run: `curl -sS -I http://localhost:8096/ | head -1`
Expected: `HTTP/1.1 200 OK`

- [ ] **Step 8: Commit**

```bash
cd /home/colin/projects/home-assistant-addons
git add backend/Dockerfile backend/.dockerignore chiba-home-search-deploy/nginx.conf chiba-home-search-deploy/compose.yaml
git commit -m "feat(deploy): add backend container and nginx /api proxy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Frontend — render live listings

**Files:**
- Modify: `chiba-home-search/index.html` (add a live-listings card inside `#results`)
- Modify: `chiba-home-search/app.js` (call the API, render cards)
- Modify: `chiba-home-search/styles.css` (listing card styles)

**Interfaces:**
- Consumes: `GET /api/search` (same origin) returning `{ portals: [{ source, status, count, scanned, listings:[...] }], cached }`.
- Consumes (existing globals in app.js): `$`, `fmtInt`, and the `s` object from `buildJapaneseTerms()` (`s.city.{jis,ja}`, `s.minYen`, `s.maxYen`, `s.layout.key`, `s.age.key`, `s.walk.key`, `s.usesAge`).

- [ ] **Step 1: Add the live-listings card to `chiba-home-search/index.html`**

Inside `<section id="results" ...>`, immediately AFTER the portals card (the `<div class="card" aria-labelledby="portals-h"> ... </div>` block), add:

```html
  <div class="card" id="live-card" aria-labelledby="live-h">
    <h2 id="live-h">Live listings from AtHome 🏠</h2>
    <p id="live-status" class="live-status"></p>
    <div id="live-listings" class="live-listings"></div>
  </div>
```

- [ ] **Step 2: Wire the call into `runSearch()` in `chiba-home-search/app.js`**

Change `runSearch` so it calls `renderLiveListings(s)` after the existing render calls. Replace the existing `runSearch` function with:

```js
function runSearch() {
  const s = buildJapaneseTerms();
  renderCriteria(s);
  renderPortals(s);
  $("results").hidden = false;
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  renderLiveListings(s);
}
```

- [ ] **Step 3: Add the rendering functions to `chiba-home-search/app.js`**

Add these functions just above the `$("search-btn").addEventListener("click", runSearch);` line:

```js
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function listingCard(x) {
  const yen = x.price && x.price.yen ? `¥${fmtInt(x.price.yen)}` : (x.price && x.price.raw) || "—";
  const bits = [];
  if (x.layout) bits.push(esc(x.layout));
  if (x.areaSqm) bits.push(`${x.areaSqm}m²`);
  if (x.buildingAge && x.buildingAge.years != null) bits.push(`${x.buildingAge.years}y old`);
  if (x.walkMin != null) bits.push(`${x.walkMin} min walk`);
  const img = x.thumbnail
    ? `<img src="${esc(x.thumbnail)}" alt="" loading="lazy">`
    : `<div class="noimg">No photo</div>`;
  const loc = [x.address ? esc(x.address) : "", x.station ? esc(x.station) + "駅" : ""]
    .filter(Boolean).join(" · ");
  return `<a class="listing" target="_blank" rel="noopener" href="${esc(x.url || "#")}">
    <div class="listing-thumb">${img}</div>
    <div class="listing-body">
      <div class="listing-price">${yen}</div>
      <div class="listing-title">${esc(x.title || "")}</div>
      <div class="listing-meta">${bits.join(" · ")}</div>
      <div class="listing-loc">${loc}</div>
    </div>
  </a>`;
}

async function renderLiveListings(s) {
  const statusEl = $("live-status");
  const listEl = $("live-listings");
  statusEl.textContent = "Searching AtHome…";
  listEl.innerHTML = "";

  const params = new URLSearchParams();
  params.set("jis", s.city.jis || "");
  params.set("cityJa", s.city.jis ? s.city.ja : "");
  if (s.minYen != null) params.set("minYen", String(Math.round(s.minYen)));
  if (s.maxYen != null) params.set("maxYen", String(Math.round(s.maxYen)));
  if (s.layout.key !== "any") params.set("layout", s.layout.key);
  if (s.usesAge && s.age.key !== "any") params.set("age", s.age.key);
  if (s.walk.key !== "any") params.set("walk", s.walk.key);

  try {
    const res = await fetch(`/api/search?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const portal = (data.portals || [])[0];
    if (!portal || portal.status !== "ok") {
      statusEl.textContent = "AtHome live search is unavailable right now — use the links above.";
      return;
    }
    if (!portal.listings.length) {
      statusEl.textContent =
        `No matches in AtHome's latest used-apartment listings for these filters (scanned ${portal.scanned || 0}). Try a wider budget, or use the links above.`;
      return;
    }
    statusEl.textContent =
      `${portal.listings.length} matching used apartments on AtHome${data.cached ? " (cached)" : ""}:`;
    listEl.innerHTML = portal.listings.map(listingCard).join("");
  } catch (err) {
    statusEl.textContent = "Couldn't reach the live search service — use the links above.";
  }
}
```

- [ ] **Step 4: Add styles to `chiba-home-search/styles.css`**

Append:

```css
.live-status { color: #555; margin: 0 0 12px; }
.live-listings {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
.listing {
  display: flex; flex-direction: column;
  border: 1px solid #e2e2e2; border-radius: 10px; overflow: hidden;
  text-decoration: none; color: inherit; background: #fff;
  transition: box-shadow .15s ease, transform .15s ease;
}
.listing:hover { box-shadow: 0 6px 18px rgba(0,0,0,.12); transform: translateY(-2px); }
.listing-thumb { aspect-ratio: 4 / 3; background: #f3f3f3; }
.listing-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.listing-thumb .noimg {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  color: #aaa; font-size: 13px;
}
.listing-body { padding: 10px 12px; }
.listing-price { font-weight: 700; font-size: 18px; color: #b5132b; }
.listing-title { font-size: 14px; margin: 2px 0 6px; line-height: 1.3; }
.listing-meta { font-size: 13px; color: #333; }
.listing-loc { font-size: 12px; color: #777; margin-top: 4px; }
@media (max-width: 540px) {
  .live-listings { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}
```

- [ ] **Step 5: Reload the static files into the running container**

Static files are bind-mounted read-only, so no rebuild is needed — they are already live. Just hard-reload the browser. Verify from the server:

Run: `curl -sS http://localhost:8096/ | grep -c "live-listings"`
Expected: `1` (the new container div is being served).

- [ ] **Step 6: Manual browser verification**

Open `http://<server-LAN-IP>:8096/`, choose "Used apartment / condo", set a Max budget (e.g. 30,000,000 JPY), click "Build my searches →". Expected: the existing criteria + portal links appear, and below them a "Live listings from AtHome" card populates with real listing cards (photo, price, layout, location) linking out to AtHome. Try a city like Funabashi to confirm city filtering.

- [ ] **Step 7: Commit**

```bash
cd /home/colin/projects/home-assistant-addons
git add chiba-home-search/index.html chiba-home-search/app.js chiba-home-search/styles.css
git commit -m "feat(web): render live AtHome listings under search results

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Ops notes + final verification

**Files:**
- Create: `chiba-home-search-deploy/README.md`

- [ ] **Step 1: Write `chiba-home-search-deploy/README.md`**

```markdown
# Chiba Home Search — deployment

Two-container stack behind host port **8096**:
- `chiba-home-search` — nginx:alpine, serves the static site and proxies `/api/` to the backend.
- `chiba-home-search-api` — Node backend that scrapes AtHome and returns JSON listings.

## Open
http://<server-LAN-IP>:8096/

## Manage
- Up / rebuild:   `docker compose -f $(pwd)/compose.yaml up -d --build`
- Stop:           `docker compose -f $(pwd)/compose.yaml stop`
- Start:          `docker compose -f $(pwd)/compose.yaml start`
- Restart:        `docker compose -f $(pwd)/compose.yaml restart`
- Logs (API):     `docker logs -f chiba-home-search-api`

## Update after a git pull
- Static frontend changes (chiba-home-search/*) are live immediately (bind mount) — just hard-reload.
- Backend changes (backend/*) need a rebuild:
  `docker compose -f $(pwd)/compose.yaml up -d --build chiba-home-search-api`

## Notes
- Backend listens internally on :3000 (not exposed to the LAN); only nginp on :8096 is public.
- AtHome price/layout/age/walk filters are applied in the backend (they are not GET-addressable on AtHome). The backend scans the first 3 result pages per search and caches results ~10 min.
- Phase 0 covers AtHome + used apartments only.
```

- [ ] **Step 2: Fix the typo placeholder above**

In the README you just wrote, change `nginp` to `nginx`. (Intentional flag: verify the word reads "only nginx on :8096 is public".)

- [ ] **Step 3: Full backend test suite**

Run: `cd /home/colin/projects/home-assistant-addons/backend && node --test`
Expected: all tests PASS.

- [ ] **Step 4: End-to-end smoke through the running stack**

Run:
```bash
curl -sS http://localhost:8096/api/health
curl -sS "http://localhost:8096/api/search?jis=12204&cityJa=%E8%88%B9%E6%A9%8B%E5%B8%82&maxYen=30000000" | head -c 300
curl -sS -I http://localhost:8096/ | head -1
```
Expected: `{"ok":true}`; then JSON with `"status":"ok"` and a `count`; then `HTTP/1.1 200 OK`.

- [ ] **Step 5: Commit**

```bash
cd /home/colin/projects/home-assistant-addons
git add chiba-home-search-deploy/README.md
git commit -m "docs(deploy): add ops README for the two-container stack

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Follow-on (future plans, not in this plan)

- **Phase 1:** SUUMO + HOME'S adapters (same adapter interface; point at their deeper paginated list URLs). Add to `runSearch` so `portals` returns multiple sources.
- **Phase 2:** HouseDo adapter (map the post-city-selection list URL).
- Other property types (houses, land) per portal; pagination UI; persistence.

## Notes for the implementer

- The fixture in Task 4 is a real snapshot; if AtHome changes its markup, `parseListings` tests fail first — that is the early-warning system. Fix selectors against a fresh fixture, do not weaken the assertions.
- Keep scraping polite: the `PAGE_DELAY_MS` delay and the 10-minute cache exist on purpose. Do not raise `PAGES_TO_FETCH` aggressively.
- `Date.now()` is used in `cache.js`; that is fine in application code (only workflow scripts forbid it).
