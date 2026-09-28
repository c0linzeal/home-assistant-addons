// Ranks indexed files against a parsed description. Every result carries the reasons it
// matched, so the UI can show "Name contains 'budget' · Tagged Travel · Modified Apr 2026".
const { CATEGORIES } = require('./taxonomy');
const { CJK } = require('./query');
const { cosine, fromBase64 } = require('./embeddings');
const { DAY } = require('./dates');

const SUFFIXES = new Set(['', 's', 'es', 'ed', 'ing', "'s", '’s']);
const LETTER = /[\p{L}\p{N}]/u;

/** Occurrences of `term` in lowercase `hay` as a whole word (allowing plural/verb endings). */
function countMatches(hay, term, cap = 6) {
  if (!hay || !term) return 0;
  if (CJK.test(term)) {
    let n = 0, i = -1;
    while (n < cap && (i = hay.indexOf(term, i + 1)) !== -1) n++;
    return n;
  }
  const alt = term.endsWith('y') ? term.slice(0, -1) + 'ies' : null;
  let n = 0;
  for (const t of alt ? [term, alt] : [term]) {
    let i = -1;
    while (n < cap && (i = hay.indexOf(t, i + 1)) !== -1) {
      if (i > 0 && LETTER.test(hay[i - 1])) continue;
      let j = i + t.length;
      let rest = '';
      while (j < hay.length && rest.length < 4 && (LETTER.test(hay[j]) || hay[j] === "'" || hay[j] === '’')) rest += hay[j++];
      if (t === alt ? rest === '' : SUFFIXES.has(rest)) n++;
    }
  }
  return n;
}

function firstMatch(hay, term) {
  if (CJK.test(term)) return hay.indexOf(term);
  let i = -1;
  while ((i = hay.indexOf(term, i + 1)) !== -1) if (i === 0 || !LETTER.test(hay[i - 1])) return i;
  return -1;
}

/** Lowercase caches used by matching. Rebuilt whenever a record changes. */
function prepare(rec) {
  const cat = effectiveCategory(rec);
  rec._name = rec.name.toLowerCase().replace(/[_]+/g, ' ');
  rec._folder = rec.folder.toLowerCase().replace(/[\\/_]+/g, ' ');
  rec._text = `${rec.title ?? ''}\n${rec.text ?? ''}`.toLowerCase();
  rec._tags = [cat && CATEGORIES[cat.id]?.label, rec.jev?.doctype?.id, rec.jev?.important >= 0.6 && 'important'].filter(Boolean).join(' ').toLowerCase();
  rec._vec = rec.vec ? fromBase64(rec.vec) : null;
  rec._dates = [rec.jev?.docDate ? new Date(`${rec.jev.docDate}T12:00:00`).getTime() : null, rec.mtime, rec.ctime].filter(Boolean);
  return rec;
}

function effectiveCategory(rec) {
  if (rec.jev?.category?.id) return { id: rec.jev.category.id, confidence: rec.jev.category.confidence, probs: rec.jev.category.probs, local: false };
  return rec.local ?? null;
}

function inScope(rec, scope) {
  if (!scope || scope.type === 'all' || scope.type === 'recent') return true;
  if (scope.type === 'root') return rec.root === scope.id;
  if (scope.type === 'kind') return rec.group === scope.id;
  if (scope.type === 'category') return effectiveCategory(rec)?.id === scope.id;
  if (scope.type === 'tag') {
    if (scope.id === 'important') return (rec.jev?.important ?? 0) >= 0.6;
    if (scope.id === 'sensitive') return (rec.jev?.sensitive ?? 0) >= 0.6;
    if (scope.id === 'untagged') return !rec.jev;
  }
  return true;
}

/** 1 inside the range, fading with distance outside it. */
function dateCloseness(dates, when) {
  const len = Math.max(when.to - when.from, 14 * DAY);
  let best = 0;
  for (const d of dates) {
    if (d >= when.from && d <= when.to) return 1;
    const dist = d < when.from ? when.from - d : d - when.to;
    best = Math.max(best, Math.exp(-dist / (0.35 * len)));
  }
  return best;
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function snippetFor(rec, terms) {
  const text = rec.text ?? '';
  if (!text || !terms.length) return null;
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = firstMatch(lower, t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return null;
  const start = Math.max(0, at - 70);
  const end = Math.min(text.length, at + 150);
  const slice = text.slice(start, end).replace(/\s+/g, ' ');
  const low = slice.toLowerCase();
  const marks = [];
  for (const t of terms) {
    let i = -1;
    while ((i = low.indexOf(t, i + 1)) !== -1) {
      if (!CJK.test(t) && i > 0 && LETTER.test(low[i - 1])) continue;
      let j = i + t.length;
      while (j < low.length && LETTER.test(low[j]) && j - i - t.length < 3) j++;
      marks.push([i, j]);
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  return { text: `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`, offset: start > 0 ? 1 : 0, marks };
}

/**
 * @param {object[]} records prepared index records
 * @param {ReturnType<import('./query').parseQuery>} parsed
 * @param {{ intent?: {categories:Record<string,number>,kinds:Record<string,number>}, queryVec?: Float32Array, scope?: object, limit?: number }} opts
 */
function search(records, parsed, { intent = null, queryVec = null, scope = null, limit = 300 } = {}) {
  const terms = [...parsed.terms, ...parsed.phrases];
  const hasTerms = terms.length > 0;
  // Areas of life: explicit words count fully; Jev's reading of the whole sentence fills in.
  const cats = { ...(intent?.categories ?? {}) };
  for (const id of Object.keys(parsed.categories)) cats[id] = Math.max(cats[id] ?? 0, 0.85);
  const hasCats = Object.keys(cats).length > 0;
  const kindSoft = intent?.kinds ?? {};

  const pool = records.filter((r) => inScope(r, scope)
    && (!parsed.kinds.length || parsed.kinds.includes(r.group))
    && (!parsed.folder || r._folder.split(' ')[0].startsWith(parsed.folder.slice(0, 5))));

  // Rarer words matter more ("invoice" beats "2024").
  const idf = {};
  for (const t of terms) {
    let df = 0;
    for (const r of pool) if (countMatches(r._name, t, 1) || countMatches(r._folder, t, 1) || countMatches(r._text, t, 1) || countMatches(r._tags, t, 1)) df++;
    idf[t] = Math.log(1 + (pool.length + 1) / (df + 0.5));
  }
  const idfSum = terms.reduce((s, t) => s + idf[t], 0) || 1;

  const out = [];
  for (const r of pool) {
    const reasons = [];
    let text = 0;
    const nameHits = [], textHits = [], folderHits = [], tagHits = [];
    for (const t of terms) {
      const isPhrase = t.includes(' ');
      const inName = isPhrase ? r._name.includes(t) : countMatches(r._name, t, 1) > 0;
      const inFolder = isPhrase ? r._folder.includes(t) : countMatches(r._folder, t, 1) > 0;
      const inTags = !isPhrase && countMatches(r._tags, t, 1) > 0;
      const tf = isPhrase ? (r._text.includes(t) ? 1 : 0) : countMatches(r._text, t);
      const s = Math.max(inName ? 1 : 0, inTags ? 0.7 : 0, inFolder ? 0.55 : 0, tf ? 0.35 + 0.4 * (tf / (tf + 1.5)) : 0);
      text += idf[t] * s;
      if (inName) nameHits.push(t); else if (tf) textHits.push(t); else if (inFolder) folderHits.push(t); else if (inTags) tagHits.push(t);
    }
    text /= idfSum;

    let sem = 0;
    if (queryVec && r._vec && r._vec.length === queryVec.length) sem = Math.max(0, Math.min(1, (cosine(queryVec, r._vec) - 0.18) / 0.4));

    let cat = 0;
    const eff = effectiveCategory(r);
    if (hasCats && eff) {
      const probs = eff.probs ?? { [eff.id]: eff.confidence };
      for (const [id, p] of Object.entries(cats)) cat += p * (probs[id] ?? 0);
      cat = Math.min(1, cat * 1.4);
    }

    let score;
    if (hasTerms) {
      const base = queryVec && r._vec ? 0.6 * text + 0.4 * sem : text;
      if (base < 0.1 && cat < 0.45 && sem < 0.45) continue;
      score = base + (hasCats ? 0.3 * cat : 0);
    } else if (hasCats) {
      if (cat < 0.3) continue;
      score = cat;
    } else {
      score = 0.5; // only kind, folder or date filters: everything that passes them
    }

    let date = 1;
    if (parsed.when) {
      date = dateCloseness(r._dates, parsed.when);
      if (date < 0.15) continue;
      score *= 0.3 + 0.7 * date;
    }
    for (const [g, p] of Object.entries(kindSoft)) if (r.group === g) score += 0.12 * p;
    if (parsed.hint === 'screenshot' && /screen ?shot|スクリーンショット|capture|snip/i.test(r.name)) score += 0.3;

    // Reasons, strongest first.
    if (nameHits.length) reasons.push({ type: 'name', text: `Name contains ${quoteList(nameHits)}` });
    if (textHits.length) reasons.push({ type: 'text', text: `Mentions ${quoteList(textHits)}` });
    if (folderHits.length) reasons.push({ type: 'folder', text: `In a folder about ${quoteList(folderHits)}` });
    if (sem >= 0.45 && !nameHits.length) reasons.push({ type: 'meaning', text: 'Similar in meaning' });
    if (hasCats && cat >= 0.3 && eff) reasons.push({ type: 'category', text: `${eff.local ? 'Looks like' : 'Jev tagged'} ${CATEGORIES[eff.id]?.label ?? eff.id}${eff.local ? '' : ` (${Math.round((eff.confidence ?? 0) * 100)}%)`}` });
    if (tagHits.length && !reasons.some((x) => x.type === 'category')) reasons.push({ type: 'category', text: `Tagged ${quoteList(tagHits)}` });
    if (parsed.when && date >= 0.5) {
      const inside = r.jev?.docDate && dateCloseness([r._dates[0]], parsed.when) >= 0.5;
      reasons.push({ type: 'date', text: inside ? `Dated ${fmtDate(r._dates[0])} inside the document` : `Modified ${fmtDate(r.mtime)}` });
    }

    out.push({ rec: r, score, reasons, snippet: snippetFor(r, terms) });
  }
  out.sort((a, b) => (hasTerms || hasCats ? b.score - a.score : 0) || b.rec.mtime - a.rec.mtime);
  return { total: out.length, results: out.slice(0, limit) };
}

const quoteList = (ts) => ts.slice(0, 3).map((t) => `“${t}”`).join(', ');

/** Plain listing for a sidebar location, newest first. */
function browse(records, scope, { limit = 2000 } = {}) {
  const list = records.filter((r) => inScope(r, scope)).sort((a, b) => b.mtime - a.mtime);
  return { total: list.length, results: list.slice(0, scope?.type === 'recent' ? 200 : limit).map((rec) => ({ rec, score: 0, reasons: [], snippet: null })) };
}

module.exports = { search, browse, prepare, countMatches, effectiveCategory, inScope, dateCloseness };
