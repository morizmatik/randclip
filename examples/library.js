'use strict';
// Usage: node examples/library.js "https://youtu.be/VIDEO_ID"
// Prints progress, cancels on Ctrl+C, and lists the files that were written.
const { fetchClips } = require('..');

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());

fetchClips(
  { urls: process.argv.slice(2), per: 3, len: 4, out: './clips' },
  {
    signal: controller.signal,
    onEvent: event => {
      if (event.type === 'video') console.log(`video ${event.index}/${event.total}: ${event.duration} s`);
      if (event.type === 'clip') console.log(`  saved ${event.file}`);
      if (event.type === 'warn') console.warn(`  ${event.message}`);
    },
  },
).then(
  ({ dir, files }) => console.log(`${files.length} clips in ${dir}`),
  err => { console.error(err.message); process.exitCode = 1; },
);
