// Turns a vague description ("that spreadsheet about the trip budget from last spring")
// into structure: keywords, file kinds, a date range, likely areas of life and a folder.
// This runs locally and instantly on every keystroke; Jev refines the areas of life
// when an OpenRouter key is set.
const { parseWhen } = require('./dates');
const { CATEGORIES } = require('./taxonomy');
const { GROUPS } = require('./kinds');

const STOPWORDS = new Set(`a an the that this those these i me my mine we our you your it its is was were be been am are
to of in on at for from with about by and or but not no any some something thing things stuff file files document documents
doc docs one ones find show get look looking search searching where which what who whose had have has did do does made make
created saved downloaded sent received got kind sort type like maybe think thought probably somewhere around ago past recent
recently lately old older new newer latest when time there here just can could would should please want need remember
wrote written write copy version called named name titled`.split(/\s+/));

// Explicit kind words. `keep` leaves the word in the keywords too (useful in file names).
const KIND_WORDS = [
  { re: /\b(?:spread\s*sheets?|excel|xlsx?|workbooks?|csv|sheets?)\b/g, groups: ['spreadsheet'] },
  { re: /\bpdfs?\b/g, groups: ['pdf'] },
  { re: /\b(?:word\s+(?:docs?|documents?|files?)|docx?)\b/g, groups: ['document'] },
  { re: /\b(?:presentations?|slide\s*decks?|slides?|decks?|power\s*points?|pptx?|keynotes?)\b/g, groups: ['presentation'] },
  { re: /\b(?:screen\s*shots?|screen\s*grabs?|screen\s*caps?)\b|スクリーンショット/g, groups: ['image'], hint: 'screenshot' },
  { re: /\b(?:photos?|pictures?|pics?|images?|jpe?gs?|pngs?|selfies?|snaps?)\b/g, groups: ['image'] },
  { re: /\b(?:scans?|scanned)\b/g, groups: ['pdf', 'image'], keep: true },
  { re: /\b(?:videos?|movies?|clips?|mp4s?|footage)\b/g, groups: ['video'] },
  { re: /\b(?:songs?|music|audio|mp3s?|voice\s+memos?|podcasts?|recordings?)\b/g, groups: ['audio'] },
  { re: /\b(?:zips?|zipped|archives?)\b/g, groups: ['archive'] },
  { re: /\b(?:source\s+code|code|scripts?)\b/g, groups: ['code'] },
  { re: /\b(?:installers?|setup\s+files?|exes?|programs?)\b/g, groups: ['installer'] },
  { re: /\b(?:notes?|text\s+files?|txt|markdown)\b/g, groups: ['text', 'document'], keep: true },
  { re: /\b(?:emails?|e-mails?)\b/g, groups: ['text'], keep: true },
];

const FOLDER_WORDS = /\b(?:in|on|from|inside)\s+(?:my\s+|the\s+)?(downloads?|desktop|documents|pictures|photos|onedrive|dropbox)(?:\s+folder)?\b/;

// Words that are category keywords but too ambiguous to steer the category on their own.
const WEAK = new Set(['return', 'order', 'service', 'will', 'build', 'id', 'lab', 'paper', 'report', 'letter', 'project',
  'game', 'music', 'code', 'personal', 'food', 'class', 'study', 'water', 'gas', 'phone', 'birth', 'blood', 'client', 'setup']);

const CJK = /[぀-ヿ㐀-鿿가-힯]/;

/** Singular, lowercase form used on both sides of matching. */
function stem(word) {
  let w = word.toLowerCase().replace(/['’]s$/, '');
  if (CJK.test(w) || w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(w)) return w;
  if (/(xes|ches|shes|sses|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

function tokenize(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
}

const CAT_INDEX = (() => {
  const m = new Map();
  for (const [id, c] of Object.entries(CATEGORIES)) {
    for (const k of c.keywords) if (!WEAK.has(k)) m.set(stem(k), id);
  }
  return m;
})();

/**
 * @returns {{
 *   raw: string, terms: string[], phrases: string[], kinds: string[], hint: string|null,
 *   when: {from:number,to:number,label:string}|null, categories: Record<string, number>,
 *   folder: string|null, chips: Array<{type:string,id:string,label:string}>
 * }}
 */
function parseQuery(raw, now = new Date()) {
  let q = ` ${raw.trim()} `;
  const chips = [];

  const phrases = [];
  q = q.replace(/"([^"]{2,})"|“([^”]{2,})”/g, (_, a, b) => { phrases.push((a ?? b).toLowerCase()); return ' '; });

  const when = parseWhen(q, now);
  if (when) {
    q = q.replace(new RegExp(escapeRe(when.matched), 'i'), ' ');
    chips.push({ type: 'when', id: 'when', label: when.label });
  }

  let folder = null;
  const fm = q.toLowerCase().match(FOLDER_WORDS);
  if (fm) {
    folder = fm[1].replace(/^download$/, 'downloads').replace(/^photos$/, 'pictures');
    q = q.slice(0, fm.index) + ' ' + q.slice(fm.index + fm[0].length);
    chips.push({ type: 'folder', id: folder, label: `In ${folder[0].toUpperCase()}${folder.slice(1)}` });
  }

  const kinds = new Set();
  let hint = null;
  let lower = q.toLowerCase();
  for (const k of KIND_WORDS) {
    k.re.lastIndex = 0;
    if (!k.re.test(lower)) continue;
    k.groups.forEach((g) => kinds.add(g));
    if (k.hint) hint = k.hint;
    if (!k.keep) { k.re.lastIndex = 0; lower = lower.replace(k.re, ' '); }
  }
  if (kinds.size) {
    const label = hint === 'screenshot' ? 'Screenshots' : [...kinds].map((g) => GROUPS[g]).join(' or ');
    chips.push({ type: 'kind', id: [...kinds].join(','), label });
  }

  const terms = [];
  const categories = {};
  for (const tok of tokenize(lower)) {
    const clean = tok.replace(/['’]s$/, '');
    if (STOPWORDS.has(clean) || clean.length < 2) continue;
    const s = stem(clean);
    if (!terms.includes(s)) terms.push(s);
    const cat = CAT_INDEX.get(s);
    if (cat) categories[cat] = 1;
  }
  for (const id of Object.keys(categories)) chips.push({ type: 'category', id, label: CATEGORIES[id].label, source: 'words' });

  return { raw: raw.trim(), terms, phrases, kinds: [...kinds], hint, when: when ? { from: when.from, to: when.to, label: when.label } : null, categories, folder, chips };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { parseQuery, stem, tokenize, CJK };
