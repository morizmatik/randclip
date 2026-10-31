'use strict';
// Runs the CLI with --json and reads its events line by line.
// The same approach works from any language that can start a process.
// Usage: node examples/stream-events.js "https://youtu.be/VIDEO_ID"
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');

const cli = path.join(__dirname, '..', 'bin', 'randclip');
const child = spawn(process.execPath, [cli, '--json', ...process.argv.slice(2)], { stdio: ['ignore', 'pipe', 'inherit'] });

readline.createInterface({ input: child.stdout }).on('line', line => {
  const event = JSON.parse(line);
  if (event.type === 'clip') console.log('clip:', event.path);
  else if (event.type === 'done') console.log(`done: ${event.files} files in ${event.dir}`);
  else if (event.type === 'error') console.error(`error (${event.code}): ${event.message}`);
});
child.on('close', code => { process.exitCode = code; });
