'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'randclip');
const cli = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args], {
  encoding: 'utf8', env: { ...process.env, ...env },
});

test('--help prints usage and exits 0', () => {
  const r = cli(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /--search/);
  assert.match(r.stdout, /--audio/);
});

test('--version prints the package version', () => {
  assert.equal(cli(['--version']).stdout.trim(), require('../package.json').version);
});

test('no arguments print usage and exit 2', () => {
  const r = cli([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage:/);
});

test('an unknown option exits 2', () => {
  const r = cli(['--nope', 'https://a.example']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /randclip:/);
});

test('an invalid value exits 2 and says which one', () => {
  const r = cli(['--per', '0', 'https://a.example']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /"per"/);
});

test('missing tools: exit 1 with an install hint (text and --json)', () => {
  const env = { PATH: path.join(__dirname, 'no-such-dir') };
  const text = cli(['https://a.example/v'], env);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /Missing required tools/);
  const json = cli(['--json', 'https://a.example/v'], env);
  assert.equal(json.status, 1);
  const ev = JSON.parse(json.stdout.trim().split('\n').pop());
  assert.equal(ev.type, 'error');
  assert.equal(ev.code, 'tools');
});
