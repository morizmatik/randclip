'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickSections } = require('../src/sections');

test('segments are ordered, inside the video and do not overlap', () => {
  for (let i = 0; i < 200; i++) {
    const list = pickSections(120, 5, 4);
    assert.equal(list.length, 5);
    let prevEnd = 0;
    for (const s of list) {
      assert.ok(s.start >= prevEnd - 1e-9, 'overlap');
      assert.ok(Math.abs(s.end - s.start - 4) < 0.011, 'length');
      assert.ok(s.end <= 120 + 1e-9, 'past the end');
      prevEnd = s.end;
    }
  }
});

test('a video shorter than the segment is taken whole', () => {
  assert.deepEqual(pickSections(3, 4, 4), [{ start: 0, end: 3 }]);
});

test('the count is limited by what fits', () => {
  assert.equal(pickSections(10, 9, 4).length, 2);
});

test('invalid input gives an empty list', () => {
  assert.deepEqual(pickSections(0, 3, 4), []);
  assert.deepEqual(pickSections(60, 0, 4), []);
  assert.deepEqual(pickSections(60, 3, 0), []);
});

test('a fixed random source gives a fixed result', () => {
  assert.deepEqual(pickSections(100, 2, 10, () => 0), [{ start: 0, end: 10 }, { start: 10, end: 20 }]);
});
