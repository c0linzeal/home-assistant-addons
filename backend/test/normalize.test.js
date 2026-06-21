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
