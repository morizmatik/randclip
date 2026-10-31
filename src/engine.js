'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseInput } = require('./model');
const { pickSections } = require('./sections');

const TOOLS = [['yt-dlp', '--version'], ['ffmpeg', '-version'], ['ffprobe', '-version']];

function codedError(code, message, extra) {
  return Object.assign(new Error(message), { code }, extra);
}

function abortError() {
  return Object.assign(new Error('Aborted.'), { name: 'AbortError', code: 'aborted' });
}

// One line the user can copy, for the current platform.
function installHint(platform = process.platform) {
  if (platform === 'darwin') return 'Install them with: brew install yt-dlp ffmpeg';
  if (platform === 'win32') return 'Install them with: winget install yt-dlp.yt-dlp Gyan.FFmpeg';
  return 'Install them with: sudo apt install ffmpeg && pipx install yt-dlp (or your distribution\'s equivalent)';
}

// Looks for yt-dlp, ffmpeg and ffprobe on PATH. A tool counts as present only if it runs and exits with 0.
function checkTools({ run = spawnSync, platform = process.platform } = {}) {
  const found = {};
  const missing = [];
  for (const [name, flag] of TOOLS) {
    const res = run(name, [flag], { stdio: 'ignore', windowsHide: true });
    const ok = !res.error && res.status === 0;
    found[name] = ok;
    if (!ok) missing.push(name);
  }
  return {
    ytdlp: found['yt-dlp'], ffmpeg: found.ffmpeg, ffprobe: found.ffprobe,
    missing, hint: missing.length ? installHint(platform) : '',
  };
}

// Kill a child together with everything it started (yt-dlp starts helpers).
function killTree(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
  const timer = setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }, 3000);
  if (timer.unref) timer.unref();
}

// Runs a command without a shell. Resolves { code, stdout, stderr }; rejects with an AbortError on abort.
function exec(cmd, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const child = spawn(cmd, args, {
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', c => { stderr = (stderr + c).slice(-4000); });
    const onAbort = () => killTree(child);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => { if (signal) signal.removeEventListener('abort', onAbort); };
    child.on('error', err => { cleanup(); reject(err); });
    child.on('close', code => {
      cleanup();
      if (signal && signal.aborted) reject(abortError());
      else resolve({ code, stdout, stderr });
    });
  });
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function lastLine(text) {
  return String(text || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
}

// Prefer H.264 in mp4 so the segment can be cut by byte range and copied without re-encoding.
function formatSelector(height) {
  return `bv*[height<=${height}][vcodec^=avc1][ext=mp4]/bv*[height<=${height}][vcodec^=avc1]/bv*[height<=${height}]`;
}

// Downloads random segments (silent H.264 mp4) of the given videos or of a random sample of search results.
//   input: see parseInput, plus `out` (directory, default ./clips)
//   hooks: { onEvent(event), signal, deps }  (deps is for tests: { exec, checkTools, random })
// Events: search, video, skip, clip, warn. Resolves { dir, files, clips }.
async function fetchClips(input, { onEvent, signal, deps = {} } = {}) {
  const opts = parseInput(input);
  const emit = typeof onEvent === 'function' ? onEvent : () => {};
  const run = deps.exec || exec;
  const rng = deps.random || Math.random;

  const tools = (deps.checkTools || checkTools)();
  if (tools.missing.length) {
    throw codedError('tools', `Missing required tools: ${tools.missing.join(', ')}. ${tools.hint}`, { missing: tools.missing });
  }
  const step = (cmd, args) => run(cmd, args, { signal });

  const outDir = path.resolve((input && input.out) || 'clips');
  fs.mkdirSync(outDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'randclip-'));

  try {
    let urls = opts.urls;
    if (opts.mode === 'search') {
      const res = await step('yt-dlp', ['--flat-playlist', '--print', 'url', `ytsearch${opts.count * 3}:${opts.query}`]);
      if (res.code !== 0) throw codedError('search', lastLine(res.stderr) || 'The search failed.');
      const found = res.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!found.length) throw codedError('nothing', `No results for "${opts.query}".`);
      urls = shuffle(found, rng).slice(0, opts.count);
      emit({ type: 'search', query: opts.query, found: found.length, picked: urls.length });
    }

    const files = [];
    const clips = [];
    for (let v = 0; v < urls.length; v++) {
      const url = urls[v];
      const index = v + 1;
      const total = urls.length;

      const info = await step('yt-dlp', ['--no-playlist', '--skip-download', '--print', '%(id)s %(duration)s', url]);
      const line = info.stdout.split(/\r?\n/).find(Boolean) || '';
      const [rawId, rawDuration] = line.trim().split(/\s+/);
      const duration = Math.floor(parseFloat(rawDuration));
      if (info.code !== 0 || !rawId || !(duration > 0)) {
        const reason = info.code !== 0 ? (lastLine(info.stderr) || 'unavailable') : 'no duration (live stream or unavailable)';
        emit({ type: 'skip', index, total, url, reason });
        continue;
      }
      const id = rawId.replace(/[^\w-]/g, '_');
      emit({ type: 'video', index, total, url, id, duration });

      const sections = pickSections(duration, opts.per, opts.len, rng);
      for (let k = 0; k < sections.length; k++) {
        const { start, end } = sections[k];
        const stem = `s${index}-${k + 1}`;
        // --downloader native: with --download-sections yt-dlp otherwise hands the job to ffmpeg,
        // which often times out on YouTube. The native downloader fetches just the needed byte range.
        const dl = await step('yt-dlp', [
          '--no-playlist', '-q', '--no-warnings', '--downloader', 'native',
          '-f', formatSelector(opts.height), '--download-sections', `*${start}-${end}`,
          '-o', path.join(work, `${stem}.%(ext)s`), url,
        ]);
        const src = dl.code === 0 ? fs.readdirSync(work).find(f => f.startsWith(stem + '.')) : null;
        if (!src) {
          emit({ type: 'warn', index, url, message: `Segment ${start}-${end} s was not downloaded${dl.code ? ': ' + lastLine(dl.stderr) : ''}` });
          continue;
        }
        const srcPath = path.join(work, src);

        const probe = await step('ffprobe', [
          '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt', '-of', 'csv=p=0', srcPath,
        ]);
        const copy = probe.code === 0 && probe.stdout.trim() === 'h264,yuv420p';
        const file = `${id}_${start}-${end}.mp4`;
        const target = path.join(outDir, file);
        const video = copy
          ? ['-c:v', 'copy']
          : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'];
        const enc = await step('ffmpeg', ['-v', 'error', '-y', '-i', srcPath, '-an', ...video, '-movflags', '+faststart', target]);
        fs.rmSync(srcPath, { force: true });
        if (enc.code !== 0) {
          fs.rmSync(target, { force: true });
          emit({ type: 'warn', index, url, message: `ffmpeg failed for segment ${start}-${end} s: ${lastLine(enc.stderr)}` });
          continue;
        }
        const clip = { file, path: target, url, id, start, end };
        files.push(file);
        clips.push(clip);
        emit({ type: 'clip', index, total, ...clip });
      }
    }

    if (!files.length) throw codedError('nothing', 'No clips were produced.');
    return { dir: outDir, files, clips };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { fetchClips, checkTools, installHint, exec, formatSelector };
