// Two jobs:
//  1. parseWhen(): turn the vague time part of a search ("last spring", "a few months
//     ago", "around Christmas", "2023") into a date range.
//  2. dateCandidates(): find dates written inside a document, so Jev can choose which
//     one is the document's own date.

const DAY = 86400000;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthIndex = (s) => MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().slice(0, 3)));
const SEASONS = { spring: 2, summer: 5, autumn: 8, fall: 8, winter: 11 }; // first month (0-based)
const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3, several: 4 };

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const monthStart = (y, m) => new Date(y, m, 1);
const monthEnd = (y, m) => new Date(y, m + 1, 0, 23, 59, 59, 999);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate(), d.getHours(), d.getMinutes());
const fmtMonth = (d) => d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
const fmtDay = (d) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function range(from, to, label) {
  return { from: from.getTime(), to: to.getTime(), label };
}

function labelFor(from, to) {
  if (from.getFullYear() === to.getFullYear() && from.getMonth() === 0 && to.getMonth() === 11 && to.getDate() === 31) return String(from.getFullYear());
  if (from.getDate() === 1 && to.getDate() === new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate()) {
    return from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear() ? fmtMonth(from) : `${fmtMonth(from)} – ${fmtMonth(to)}`;
  }
  return `${fmtDay(from)} – ${fmtDay(to)}`;
}

// "early", "mid", "late" narrow a period to its first, middle or last third.
function narrow(r, part) {
  if (!part) return r;
  const len = r.to - r.from;
  const third = len / 3;
  const from = part === 'early' ? r.from : part === 'late' ? r.from + 2 * third : r.from + third;
  const to = from + third;
  return { from, to, label: `${part === 'mid' ? 'mid' : part} ${r.label}` };
}

function seasonRange(season, year) {
  const m = SEASONS[season];
  // Winter starts in December and runs into the next year.
  return [monthStart(year, m), monthEnd(m === 11 ? year + 1 : year, m === 11 ? 1 : m + 2)];
}

const PATTERNS = [
  // last 3 days / past two weeks / previous 6 months
  [/\b(?:last|past|previous)\s+(\d+|two|three|four|five|six|seven|eight|nine|ten|few|couple(?:\s+of)?)\s+(day|week|month|year)s?\b/, (m, now) => {
    const n = Number(m[1]) || NUMBERS[m[1].replace(/\s+of$/, '')] || 3;
    const from = m[2] === 'day' ? new Date(now - n * DAY) : m[2] === 'week' ? new Date(now - n * 7 * DAY) : addMonths(now, m[2] === 'month' ? -n : -12 * n);
    return range(startOfDay(from), now, `past ${n} ${m[2]}s`);
  }],
  // 3 weeks ago / a few months ago / a couple of years ago
  [/\b(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|(?:a\s+)?few|(?:a\s+)?couple(?:\s+of)?|several)\s+(day|week|month|year)s?\s+ago\b/, (m, now) => {
    const word = m[1].replace(/^a\s+/, '').replace(/\s+of$/, '');
    const n = Number(word) || NUMBERS[word] || 1;
    const vague = /few|couple|several/.test(word);
    const unitMs = { day: DAY, week: 7 * DAY, month: 30.4 * DAY, year: 365 * DAY }[m[2]];
    const lo = vague ? Math.max(1, n - 1.5) : Math.max(0.5, n - 0.5 - (n > 2 ? n * 0.2 : 0));
    const hi = vague ? n + 3 : n + 0.5 + (n > 2 ? n * 0.2 : 0);
    const from = new Date(now.getTime() - hi * unitMs);
    const to = new Date(now.getTime() - lo * unitMs);
    return range(startOfDay(from), endOfDay(to), `${m[1]} ${m[2]}s ago`.replace(/^(an?|one) (\w+)s/, '$1 $2'));
  }],
  [/\btoday\b/, (m, now) => range(startOfDay(now), endOfDay(now), 'Today')],
  [/\byesterday\b/, (m, now) => { const y = new Date(now - DAY); return range(startOfDay(y), endOfDay(y), 'Yesterday'); }],
  [/\b(this|last|past|previous)\s+week\b/, (m, now) => {
    const monday = startOfDay(new Date(now - ((now.getDay() + 6) % 7) * DAY));
    if (m[1] === 'this') return range(monday, now, 'This week');
    if (m[1] === 'past') return range(startOfDay(new Date(now - 7 * DAY)), now, 'Past week');
    return range(new Date(monday - 7 * DAY), new Date(monday - 1), 'Last week');
  }],
  [/\b(this|last|past|previous)\s+month\b/, (m, now) => {
    if (m[1] === 'this') return range(monthStart(now.getFullYear(), now.getMonth()), now, 'This month');
    if (m[1] === 'past') return range(startOfDay(addMonths(now, -1)), now, 'Past month');
    const d = addMonths(monthStart(now.getFullYear(), now.getMonth()), -1);
    return range(d, monthEnd(d.getFullYear(), d.getMonth()), fmtMonth(d));
  }],
  [/\b(?:(early|mid|late)[\s-]+)?(this|last|past|previous)\s+year\b/, (m, now) => {
    const y = now.getFullYear();
    let r;
    if (m[2] === 'this') r = range(new Date(y, 0, 1), now, String(y));
    else if (m[2] === 'past') r = range(startOfDay(addMonths(now, -12)), now, 'Past year');
    else r = range(new Date(y - 1, 0, 1), monthEnd(y - 1, 11), String(y - 1));
    return narrow(r, m[1]);
  }],
  // last spring / summer 2024 / this winter / early fall of 2023
  [/\b(?:(early|mid|late)[\s-]+)?(?:(last|this|previous)\s+)?(spring|summer|autumn|fall|winter)(?:\s+(?:of\s+)?((?:19|20)\d{2}))?\b/, (m, now) => {
    const season = m[3];
    let year;
    if (m[4]) year = Number(m[4]) - (season === 'winter' ? 1 : 0);
    else {
      // Most recent occurrence that has started. "last" skips the one we're in now.
      year = now.getFullYear();
      let [from] = seasonRange(season, year);
      if (from > now) { year--; [from] = seasonRange(season, year); }
      const [, to] = seasonRange(season, year);
      if ((m[2] === 'last' || m[2] === 'previous') && to > now) year--;
    }
    const [from, to] = seasonRange(season, year);
    const name = season === 'fall' ? 'autumn' : season;
    return narrow(range(from, to, `${name[0].toUpperCase()}${name.slice(1)} ${season === 'winter' ? `${year}–${String(year + 1).slice(2)}` : year}`), m[1]);
  }],
  [/\b(?:around\s+|at\s+)?(christmas|xmas|new\s+year'?s?|golden\s+week|obon)(?:\s+((?:19|20)\d{2}))?\b/, (m, now) => {
    const key = m[1].startsWith('new') ? 'new year' : m[1].replace(/\s+/g, ' ');
    const spans = { christmas: [11, 15, 11, 31], xmas: [11, 15, 11, 31], 'new year': [11, 26, 0, 10], 'golden week': [3, 26, 4, 8], obon: [7, 8, 7, 20] };
    const [m1, d1, m2, d2] = spans[key];
    let y = m[2] ? Number(m[2]) : now.getFullYear();
    const build = (yy) => [new Date(yy, m1, d1), endOfDay(new Date(m2 < m1 ? yy + 1 : yy, m2, d2))];
    let [from, to] = build(y);
    if (!m[2] && from > now) { y--; [from, to] = build(y); }
    return range(from, to, `${key.replace(/\b\w/g, (c) => c.toUpperCase())} ${y}`);
  }],
  // March 2024 / in may / last october / early june
  [new RegExp(`\\b(?:(in|last|this|since|from|during|around|of|early|mid|late)[\\s-]+)?${MONTH_RE}\\b(?:\\s+(?:of\\s+)?((?:19|20)\\d{2}))?`), (m, now) => {
    const word = m[2].toLowerCase();
    // "may" and "march" are also ordinary words: only treat them as months with context.
    if ((word === 'may' || word === 'march' || word === 'mar' || word === 'jan' || word === 'dec' || word === 'sep') && !m[1] && !m[3]) return null;
    const mi = monthIndex(word);
    let y;
    if (m[3]) y = Number(m[3]);
    else {
      y = now.getFullYear();
      if (mi > now.getMonth() || (m[1] === 'last' && mi === now.getMonth())) y--;
    }
    const part = ['early', 'mid', 'late'].includes(m[1]) ? m[1] : null;
    if (m[1] === 'since') return range(monthStart(y, mi), now, `Since ${fmtMonth(monthStart(y, mi))}`);
    return narrow(range(monthStart(y, mi), monthEnd(y, mi), fmtMonth(monthStart(y, mi))), part);
  }],
  [/\b(before|after|since)\s+((?:19|20)\d{2})\b/, (m, now) => {
    const y = Number(m[2]);
    if (m[1] === 'before') return range(new Date(1970, 0, 1), new Date(y, 0, 1), `Before ${y}`);
    return range(m[1] === 'after' ? new Date(y + 1, 0, 1) : new Date(y, 0, 1), now, `${m[1] === 'after' ? 'After' : 'Since'} ${y}`);
  }],
  [/\b(?:(early|mid|late)[\s-]+)?((?:19|20)\d{2})\b/, (m, now) => {
    const y = Number(m[2]);
    if (y > now.getFullYear() + 1) return null;
    return narrow(range(new Date(y, 0, 1), monthEnd(y, 11), String(y)), m[1]);
  }],
  [/\b(recent|recently|lately|just now|the other day)\b/, (m, now) => range(startOfDay(new Date(now - (m[1] === 'the other day' ? 10 : 45) * DAY)), now, 'Recently')],
];

/**
 * Finds the first time expression in `query`.
 * Returns { from, to, label, matched } with epoch-ms bounds, or null.
 */
function parseWhen(query, now = new Date()) {
  const q = query.toLowerCase();
  for (const [re, fn] of PATTERNS) {
    const m = q.match(re);
    if (!m) continue;
    const r = fn(m, now);
    if (r) return { ...r, matched: m[0] };
  }
  return null;
}

// ---------- dates inside documents ----------

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
function valid(y, m, d, now) {
  if (y < 1970 || y > now.getFullYear() + 2 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(y, m, 0).getDate();
}

/** Distinct dates written in `text`, in order of appearance: [{ value: 'YYYY-MM-DD', raw }]. */
function dateCandidates(text, now = new Date(), max = 12) {
  const found = new Map();
  const push = (y, m, d, raw, index) => {
    if (!valid(y, m, d, now)) return;
    const value = iso(y, m, d);
    if (!found.has(value)) found.set(value, { value, raw: raw.trim(), index });
  };
  const src = text.slice(0, 20000);
  for (const m of src.matchAll(/\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) push(+m[1], +m[2], +m[3], m[0], m.index);
  for (const m of src.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.]((?:19|20)\d{2})\b/g)) {
    const a = +m[1], b = +m[2];
    if (a > 12) push(+m[3], b, a, m[0], m.index); // clearly day first
    else push(+m[3], a, b, m[0], m.index);         // assume month first
  }
  const mon = MONTH_RE;
  for (const m of src.matchAll(new RegExp(`\\b${mon}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+((?:19|20)\\d{2})\\b`, 'gi'))) push(+m[3], monthIndex(m[1]) + 1, +m[2], m[0], m.index);
  for (const m of src.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${mon}\\.?,?\\s+((?:19|20)\\d{2})\\b`, 'gi'))) push(+m[3], monthIndex(m[2]) + 1, +m[1], m[0], m.index);
  for (const m of src.matchAll(/((?:19|20)\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/g)) push(+m[1], +m[2], +m[3], m[0], m.index);
  for (const m of src.matchAll(/令和\s*(元|\d{1,2})年\s*(\d{1,2})月\s*(\d{1,2})日/g)) push((m[1] === '元' ? 1 : +m[1]) + 2018, +m[2], +m[3], m[0], m.index);
  return [...found.values()].sort((a, b) => a.index - b.index).slice(0, max).map(({ value, raw }) => ({ value, raw }));
}

module.exports = { parseWhen, dateCandidates, DAY };
