'use strict';

const DEFAULTS = Object.freeze({ per: 3, len: 4, height: 1080, count: 5 });
const LIMITS = Object.freeze({
  per: [1, 10], len: [1, 30], height: [240, 2160], count: [1, 20],
  urls: 20, text: 4000, query: 120,
});

const MESSAGES = {
  empty: 'Nothing to download: pass at least one URL or a search query.',
  conflict: 'Pass either URLs or a search query, not both.',
  long: `The input is too long (more than ${LIMITS.text} characters).`,
  tooMany: `Too many URLs (at most ${LIMITS.urls}).`,
  notUrl: 'Not a URL',
  queryLong: `The search query is too long (more than ${LIMITS.query} characters).`,
};

class InputError extends Error {
  constructor(code, message) {
    super(message || MESSAGES[code] || code);
    this.name = 'InputError';
    this.code = code;
  }
}

// Lines of a list: comments after # removed, blank lines dropped, whitespace trimmed.
function parseList(text) {
  return String(text == null ? '' : text).split(/\r?\n/)
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

const SCHEME = /^https?:\/\//i;
const DOMAIN = /^[\w-]+(\.[\w-]+)+(\/|$)/;

// "youtu.be/abc" becomes "https://youtu.be/abc"; anything else is returned as is.
function toUrl(line) {
  return SCHEME.test(line) ? line : (DOMAIN.test(line) ? 'https://' + line : line);
}

function isUrl(value) {
  try { return SCHEME.test(value) && !!new URL(value).hostname; } catch { return false; }
}

function intIn(value, name, range, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < range[0] || n > range[1]) {
    throw new InputError(name, `"${name}" must be an integer between ${range[0]} and ${range[1]}.`);
  }
  return n;
}

// input: { urls?: string[], text?: string, query?: string, per?, len?, height?, count?, audio? }
// returns { mode: 'links' | 'search', urls, query, per, len, height, count, audio }
function parseInput(input) {
  const opts = input || {};
  const per = intIn(opts.per, 'per', LIMITS.per, DEFAULTS.per);
  const len = intIn(opts.len, 'len', LIMITS.len, DEFAULTS.len);
  const height = intIn(opts.height, 'height', LIMITS.height, DEFAULTS.height);
  const count = intIn(opts.count, 'count', LIMITS.count, DEFAULTS.count);
  const audio = opts.audio === true || opts.audio === 'true';

  const text = String(opts.text == null ? '' : opts.text);
  if (text.length > LIMITS.text) throw new InputError('long');
  const listed = Array.isArray(opts.urls) ? opts.urls.map(u => String(u).trim()).filter(Boolean) : [];
  const lines = [...listed, ...parseList(text)];
  const query = String(opts.query == null ? '' : opts.query).replace(/\s+/g, ' ').trim();

  if (query && lines.length) throw new InputError('conflict');
  if (query) {
    if (query.length > LIMITS.query) throw new InputError('queryLong');
    return { mode: 'search', urls: [], query, per, len, height, count, audio };
  }
  if (!lines.length) throw new InputError('empty');
  const urls = lines.map(toUrl);
  if (urls.length > LIMITS.urls) throw new InputError('tooMany');
  for (const u of urls) {
    if (!isUrl(u)) throw new InputError('notUrl', `Not a URL: ${u.slice(0, 80)}`);
  }
  return { mode: 'links', urls, query: '', per, len, height, count, audio };
}

module.exports = { DEFAULTS, LIMITS, InputError, parseList, toUrl, isUrl, parseInput };
