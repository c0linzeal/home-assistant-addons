// A keyword guess at a file's area of life, used when Jev hasn't tagged it (no key,
// a private folder, or not reached yet). Deliberately modest: Jev replaces it.
const { CATEGORIES } = require('./taxonomy');
const { stem, tokenize } = require('./query');

const INDEX = (() => {
  const m = new Map();
  for (const [id, c] of Object.entries(CATEGORIES)) for (const k of c.keywords) m.set(stem(k), id);
  return m;
})();

function localCategory(rec) {
  if (rec.group === 'image' || rec.group === 'video' || rec.group === 'audio') return { id: 'media', confidence: 0.9, local: true };
  if (rec.group === 'installer' || rec.group === 'code') return { id: 'tech', confidence: 0.7, local: true };
  const score = {};
  const bump = (words, w) => {
    for (const t of words) {
      const id = INDEX.get(stem(t));
      if (id) score[id] = (score[id] ?? 0) + w;
    }
  };
  bump(tokenize(rec.name.replace(/[_.]/g, ' ')), 3);
  bump(tokenize(rec.folder.replace(/[\\/_]/g, ' ')), 2);
  bump(tokenize((rec.text ?? '').slice(0, 3000)), 0.25);
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 1.5) return null;
  return { id: best[0], confidence: Math.min(0.75, 0.35 + best[1] / 20), local: true };
}

module.exports = { localCategory };
