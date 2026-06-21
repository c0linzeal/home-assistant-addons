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
