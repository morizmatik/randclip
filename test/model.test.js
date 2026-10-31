'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseList, parseInput, DEFAULTS } = require('../src/model');

const codeOf = fn => { try { fn(); return 'ok'; } catch (e) { return e.code || 'other'; } };

test('parseList drops comments, blank lines and surrounding spaces', () => {
  assert.equal(parseList('  https://a\n# note\n\n https://b # tail').join('|'), 'https://a|https://b');
});

test('a URL without a scheme gets https', () => {
  const r = parseInput({ text: 'https://youtu.be/a\nyoutu.be/b' });
  assert.equal(r.mode, 'links');
  assert.deepEqual(r.urls, ['https://youtu.be/a', 'https://youtu.be/b']);
  assert.equal(r.query, '');
});

test('URLs may come as an array, as text, or both', () => {
  assert.equal(parseInput({ urls: ['https://a.example/1'], text: 'https://a.example/2' }).urls.length, 2);
});

test('defaults are applied', () => {
  const r = parseInput({ urls: ['https://a.example/1'] });
  assert.equal(r.per, DEFAULTS.per);
  assert.equal(r.len, DEFAULTS.len);
  assert.equal(r.height, DEFAULTS.height);
  assert.equal(r.count, DEFAULTS.count);
});

test('a search query switches to search mode and collapses spaces', () => {
  const r = parseInput({ query: '  skate   clips ' });
  assert.equal(r.mode, 'search');
  assert.equal(r.query, 'skate clips');
  assert.deepEqual(r.urls, []);
});

test('invalid input is reported with a code', () => {
  assert.equal(codeOf(() => parseInput({})), 'empty');
  assert.equal(codeOf(() => parseInput({ text: ' \n # only a comment' })), 'empty');
  assert.equal(codeOf(() => parseInput({ text: 'https://a.example\nnot a url' })), 'notUrl');
  assert.equal(codeOf(() => parseInput({ urls: ['https://a.example'], query: 'x' })), 'conflict');
  assert.equal(codeOf(() => parseInput({ urls: Array.from({ length: 21 }, (_, i) => 'https://a.example/' + i) })), 'tooMany');
  assert.equal(codeOf(() => parseInput({ urls: ['https://a.example'], per: 0 })), 'per');
  assert.equal(codeOf(() => parseInput({ urls: ['https://a.example'], len: 31 })), 'len');
  assert.equal(codeOf(() => parseInput({ urls: ['https://a.example'], height: 100 })), 'height');
  assert.equal(codeOf(() => parseInput({ query: 'x', count: 21 })), 'count');
  assert.equal(codeOf(() => parseInput({ query: 'x'.repeat(121) })), 'queryLong');
  assert.equal(codeOf(() => parseInput({ urls: ['https://a.example'], per: 'abc' })), 'per');
});

test('numbers may be given as strings (command line)', () => {
  const r = parseInput({ urls: ['https://a.example'], per: '2', len: '5', height: '720' });
  assert.deepEqual([r.per, r.len, r.height], [2, 5, 720]);
});

test('audio is off by default and on only when asked', () => {
  assert.equal(parseInput({ urls: ['https://a.example'] }).audio, false);
  assert.equal(parseInput({ urls: ['https://a.example'], audio: true }).audio, true);
  assert.equal(parseInput({ query: 'x', audio: true }).audio, true);
});
