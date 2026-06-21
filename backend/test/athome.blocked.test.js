'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { looksBlocked } = require('../src/adapters/athome');

const FIXTURES = path.join(__dirname, 'fixtures');

test('looksBlocked: empty string is blocked', () => {
  assert.equal(looksBlocked(''), true);
});

test('looksBlocked: null/undefined is blocked', () => {
  assert.equal(looksBlocked(null), true);
  assert.equal(looksBlocked(undefined), true);
});

test('looksBlocked: anti-bot challenge fixture is detected as blocked', () => {
  const html = fs.readFileSync(path.join(FIXTURES, 'athome-challenge.html'), 'utf8');
  assert.equal(looksBlocked(html), true);
});

test('looksBlocked: real listings fixture is NOT blocked', () => {
  const html = fs.readFileSync(path.join(FIXTURES, 'athome-chiba-list.html'), 'utf8');
  assert.equal(looksBlocked(html), false);
});
