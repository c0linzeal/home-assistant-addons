/*
 * app.js — wires up the Chiba Home Search form.
 * No build step, no dependencies: just the data in data.js + the DOM.
 */

const $ = (id) => document.getElementById(id);

const SOURCE_NAMES = { athome: "AtHome", suumo: "SUUMO", homes: "LIFULL HOME'S", housedo: "House Do" };
const LAYOUT_EN = { "ワンルーム": "Studio", "1R": "Studio", "1K": "1K", "1DK": "1DK" };
function layoutEn(l) { if (!l) return ""; return LAYOUT_EN[l] || l; }

/* ---------- Populate dropdowns ---------- */
function fillSelect(el, items, labelFn, valueFn) {
  el.innerHTML = "";
  items.forEach((it, i) => {
    const o = document.createElement("option");
    o.value = valueFn ? valueFn(it) : i;
    o.textContent = labelFn(it);
    el.appendChild(o);
  });
}

fillSelect($("ptype"), PROPERTY_TYPES, (t) => `${t.en}  ·  ${t.ja}`, (t) => t.key);
fillSelect($("city"), CHIBA_CITIES, (c) => (c.jis ? `${c.en}  ·  ${c.ja}` : c.en), (c) => c.jis || "ALL");
fillSelect($("layout"), LAYOUTS, (l) => l.en, (l) => l.key);
fillSelect($("walk"), WALK_TIMES, (w) => w.en, (w) => w.key);
fillSelect($("age"), BUILDING_AGES, (a) => a.en, (a) => a.key);

const byKey = (arr, key) => arr.find((x) => x.key === key) || arr[0];
const cityByVal = (v) => CHIBA_CITIES.find((c) => (c.jis || "ALL") === v) || CHIBA_CITIES[0];

/* ---------- Budget helpers ---------- */
function parseNum(str) {
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}
const fmtInt = (n) => Math.round(n).toLocaleString("en-US");

// Convert a value in the chosen currency to whole yen.
function toYen(val) {
  if (val == null) return null;
  if ($("cur").value === "usd") {
    const rate = parseNum($("rate").value) || 150;
    return val * rate;
  }
  return val;
}

// Format a yen amount the Japanese way: 万円 / 億円, plus a USD hint.
function yenToJa(yen) {
  const man = yen / 10000;
  let jp;
  if (man >= 10000) {
    const oku = Math.floor(man / 10000);
    const rem = Math.round(man % 10000);
    jp = rem ? `${oku}億${fmtInt(rem)}万円` : `${oku}億円`;
  } else {
    jp = `${fmtInt(man)}万円`;
  }
  const rate = parseNum($("rate").value) || 150;
  const usd = yen / rate;
  return { jp, man: Math.round(man), pretty: `${jp}  (¥${fmtInt(yen)} ≈ $${fmtInt(usd)})` };
}

function updateReadout() {
  $("rate-field").style.display = $("cur").value === "usd" ? "" : "none";
  const max = toYen(parseNum($("bmax").value));
  const min = toYen(parseNum($("bmin").value));
  if (max == null && min == null) {
    $("budget-readout").textContent = "Enter a maximum budget to see it converted.";
    return;
  }
  const parts = [];
  if (min != null) parts.push(`From ${yenToJa(min).pretty}`);
  if (max != null) parts.push(`${min != null ? "up to" : "Up to"} ${yenToJa(max).pretty}`);
  $("budget-readout").textContent = parts.join("  ");
}

["bmax", "bmin", "rate"].forEach((id) => $(id).addEventListener("input", updateReadout));
$("cur").addEventListener("change", updateReadout);

// Hide building-age filter for land / new builds (where it doesn't apply).
function syncAgeVisibility() {
  const t = byKey(PROPERTY_TYPES, $("ptype").value);
  const usesAge = t.key === "used_apartment" || t.key === "used_house";
  $("age-field").style.display = usesAge ? "" : "none";
}
$("ptype").addEventListener("change", syncAgeVisibility);
syncAgeVisibility();
updateReadout();

/* ---------- Build & render results ---------- */
function buildJapaneseTerms() {
  const type = byKey(PROPERTY_TYPES, $("ptype").value);
  const city = cityByVal($("city").value);
  const layout = byKey(LAYOUTS, $("layout").value);
  const walk = byKey(WALK_TIMES, $("walk").value);
  const age = byKey(BUILDING_AGES, $("age").value);
  const usesAge = type.key === "used_apartment" || type.key === "used_house";

  const maxYen = toYen(parseNum($("bmax").value));
  const minYen = toYen(parseNum($("bmin").value));

  // Terms used to build the precise Google query.
  const terms = ["千葉県"];
  if (city.jis) terms.push(city.ja);
  terms.push(type.gq);
  if (layout.key !== "any") terms.push(layout.ja);
  if (walk.key !== "any") terms.push(walk.ja);
  if (usesAge && age.key !== "any") terms.push(age.ja);
  if (maxYen != null) terms.push(`${yenToJa(maxYen).man}万円以下`);
  if (minYen != null) terms.push(`${yenToJa(minYen).man}万円以上`);

  return { type, city, layout, walk, age, usesAge, maxYen, minYen, terms };
}

function renderCriteria(s) {
  const rows = [];
  const add = (k, en, ja) => rows.push({ k, en, ja });

  add("Property type", s.type.en, s.type.ja);
  add("Area", s.city.jis ? `${s.city.en}, Chiba` : "Anywhere in Chiba", s.city.jis ? s.city.ja : "千葉県");
  if (s.layout.key !== "any") add("Layout", s.layout.en, s.layout.ja);
  if (s.walk.key !== "any") add("Station distance", s.walk.en, s.walk.ja);
  if (s.usesAge && s.age.key !== "any") add("Building age", s.age.en, s.age.ja);

  if (s.maxYen != null) {
    const m = yenToJa(s.maxYen);
    add("Max price", `¥${fmtInt(s.maxYen)} ≈ $${fmtInt(s.maxYen / (parseNum($("rate").value) || 150))}`, m.jp);
  }
  if (s.minYen != null) {
    const m = yenToJa(s.minYen);
    add("Min price", `¥${fmtInt(s.minYen)}`, m.jp);
  }

  $("criteria-list").innerHTML = rows
    .map(
      (r) => `<li><span class="k">${r.k}</span>
        <span class="v">${r.en}<span class="ja">${r.ja}</span></span></li>`
    )
    .join("");
}

function googleSearch(domain, terms) {
  const q = `site:${domain} ${terms.join(" ")}`;
  return "https://www.google.com/search?q=" + encodeURIComponent(q);
}

function renderPortals(s) {
  const portals = [
    { name: "SUUMO", note: "Japan's largest property portal", domain: "suumo.jp", direct: s.type.suumo },
    { name: "LIFULL HOME'S", note: "Huge nationwide listings", domain: "homes.co.jp", direct: s.type.homes },
    { name: "AtHome", note: "Strong local-agent coverage", domain: "athome.co.jp", direct: s.type.athome },
    { name: "House Do", note: "ハウスドゥ — nationwide franchise", domain: "housedo.com", direct: s.type.housedo },
  ];

  $("portals").innerHTML = portals
    .map(
      (p) => `
      <div class="portal">
        <div class="portal-name">${p.name}<small>${p.note} · ${p.type || s.type.ja} in Chiba</small></div>
        <div class="portal-actions">
          <a class="btn solid" target="_blank" rel="noopener" href="${googleSearch(p.domain, s.terms)}">Precise Google search ↗</a>
          <a class="btn" target="_blank" rel="noopener" href="${p.direct}">Open ${p.name} ↗</a>
        </div>
      </div>`
    )
    .join("");
}

function runSearch() {
  const s = buildJapaneseTerms();
  renderCriteria(s);
  renderPortals(s);
  $("results").hidden = false;
  $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  renderLiveListings(s);
}

function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function listingCard(x, rate) {
  let yen;
  if (x.price && x.price.yen) {
    yen = `¥${fmtInt(x.price.yen)}`;
    if (rate && x.price.yen) yen += ` (&#x2248;$${fmtInt(Math.round(x.price.yen / rate))})`;
  } else {
    yen = esc((x.price && x.price.raw) || "—");
  }
  const bits = [];
  if (x.layout) bits.push(esc(layoutEn(x.layout)));
  if (x.areaSqm) bits.push(esc(`${x.areaSqm}m²`));
  if (x.buildingAge && x.buildingAge.years != null) {
    bits.push(esc(x.buildingAge.years === 0 ? "New" : `${x.buildingAge.years} years old`));
  }
  if (x.walkMin != null) bits.push(`${x.walkMin} min walk`);
  const img = x.thumbnail
    ? `<img src="${esc(x.thumbnail)}" alt="" loading="lazy">`
    : `<div class="noimg">No photo</div>`;
  const loc = [x.address ? esc(x.address) : "", x.station ? esc(x.station) + "&#39550;" : ""]
    .filter(Boolean).join(" &middot; ");
  const srcName = SOURCE_NAMES[x.source] || esc(x.source || "");
  const translateUrl = "https://translate.google.com/translate?sl=ja&tl=en&u=" + encodeURIComponent(x.url || "");
  return `<div class="listing">
    <a class="listing-imglink" target="_blank" rel="noopener" href="${esc(x.url || "#")}">
      <div class="listing-thumb">${img}</div>
    </a>
    <div class="listing-body">
      <div class="listing-price">${yen}</div>
      <div class="listing-title">${esc(x.title || "")}</div>
      <div class="listing-meta">${bits.join(" &middot; ")}</div>
      <div class="listing-loc">${loc}</div>
      <span class="source-badge">${srcName}</span>
    </div>
    <div class="listing-links">
      <a href="${esc(x.url || "#")}" target="_blank" rel="noopener">View on ${srcName} &#x2197;</a>
      <a href="${esc(translateUrl)}" target="_blank" rel="noopener">View in English &#x2197;</a>
    </div>
  </div>`;
}

async function renderLiveListings(s) {
  const statusEl = $("live-status");
  const listEl = $("live-listings");
  statusEl.textContent = "Searching portals…";
  listEl.innerHTML = "";

  const params = new URLSearchParams();
  params.set("jis", s.city.jis || "");
  params.set("cityJa", s.city.jis ? s.city.ja : "");
  if (s.minYen != null) params.set("minYen", String(Math.round(s.minYen)));
  if (s.maxYen != null) params.set("maxYen", String(Math.round(s.maxYen)));
  if (s.layout.key !== "any") params.set("layout", s.layout.key);
  if (s.usesAge && s.age.key !== "any") params.set("age", s.age.key);
  if (s.walk.key !== "any") params.set("walk", s.walk.key);
  params.set("type", s.type.key);

  const rate = parseNum($("rate").value) || 150;

  try {
    const res = await fetch(`/api/search?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const portals = data.portals || [];
    const totalListings = portals.reduce((sum, p) => sum + ((p.listings || []).length), 0);
    statusEl.textContent = `Searched ${portals.length} site(s) · ${totalListings} listing${totalListings !== 1 ? "s" : ""}${data.cached ? " (cached)" : ""}`;

    portals.forEach(function(p) {
      const srcName = SOURCE_NAMES[p.source] || p.source;
      const listings = p.listings || [];
      let statusNote;
      if (p.status !== "ok") {
        statusNote = "unavailable";
      } else if (!listings.length) {
        statusNote = `no matches (scanned ${p.scanned || 0})`;
      } else {
        statusNote = `${listings.length} listing${listings.length !== 1 ? "s" : ""}`;
      }

      const group = document.createElement("div");
      group.className = "portal-group";

      const header = document.createElement("h3");
      header.textContent = `${srcName} — ${statusNote}`;
      group.appendChild(header);

      if (p.status === "ok" && listings.length) {
        const grid = document.createElement("div");
        grid.className = "live-listings";
        grid.innerHTML = listings.map(function(x) { return listingCard(x, rate); }).join("");
        group.appendChild(grid);
      }

      listEl.appendChild(group);
    });

    if (!portals.length) {
      statusEl.textContent = "No portals returned — use the links above.";
    }
  } catch (err) {
    statusEl.textContent = "Couldn't reach the live search service — use the links above.";
  }
}

$("search-btn").addEventListener("click", runSearch);

/* ---------- Glossary ---------- */
$("glossary").innerHTML = GLOSSARY.map(
  (g) => `<div class="gloss">
    <div class="t">${g.term} <span class="r">${g.read}</span></div>
    <p class="m">${g.meaning}</p>
  </div>`
).join("");
