'use strict';

// Random, non-overlapping segments of a video of the given duration (seconds).
// The free time is split by random points, so segments come in order and never overlap.
function pickSections(duration, count, len, rng = Math.random) {
  if (!(duration > 0) || !(len > 0) || !(count >= 1)) return [];
  if (duration <= len) return [{ start: 0, end: duration }];
  const n = Math.min(Math.floor(count), Math.floor(duration / len));
  const free = duration - n * len;
  const offsets = Array.from({ length: n }, () => rng() * free).sort((a, b) => a - b);
  return offsets.map((offset, i) => {
    const start = Math.round((offset + i * len) * 100) / 100;
    return { start, end: Math.round((start + len) * 100) / 100 };
  });
}

module.exports = { pickSections };
