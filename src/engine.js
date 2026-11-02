'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseInput } = require('./model');
const { pickSections } = require('./sections');

const SEGMENT_TRIES = 3;
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
function exec(cmd, args, { signal, onStdout } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const child = spawn(cmd, args, {
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', c => { stdout += c; if (onStdout) onStdout(c); });
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

// yt-dlp prints one line per update with --progress-template; PROGRESS_TEMPLATE makes them parseable.
const PROGRESS_PREFIX = 'RC-PROGRESS';
const PROGRESS_TEMPLATE = `download:${PROGRESS_PREFIX} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s`;
const PROGRESS_EVERY_MS = 700;

// One template line -> { downloaded, size, speed, eta } (bytes, bytes, bytes/s, seconds; null when yt-dlp does not know), or null.
function parseProgress(line) {
  const m = String(line || '').match(/^RC-PROGRESS\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/);
  if (!m) return null;
  const num = v => { const n = Number(v); return v !== 'NA' && v !== 'None' && Number.isFinite(n) && n >= 0 ? n : null; };
  const downloaded = num(m[1]);
  if (downloaded === null) return null;
  return { downloaded, size: num(m[2]) ?? num(m[3]), speed: num(m[4]), eta: num(m[5]) };
}

// Turns stdout chunks into whole lines, then into throttled progress callbacks.
function progressReader(onProgress, { now = Date.now, every = PROGRESS_EVERY_MS } = {}) {
  let buf = '';
  let last = -Infinity;
  return chunk => {
    buf += chunk;
    const lines = buf.split(/\r?\n|\r/);
    buf = lines.pop();
    for (const line of lines) {
      const p = parseProgress(line);
      if (!p) continue;
      const t = now();
      if (t - last < every && !(p.size && p.downloaded >= p.size)) continue;
      last = t;
      onProgress(p);
    }
  };
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Makes a video title safe to use in a file name on macOS, Windows and Linux, and short enough to read.
function cleanTitle(title, max = 80) {
  const t = String(title || '')
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|\[\]]/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/^\.+/, '').slice(0, max).trim();
  return t.toLowerCase() === 'na' ? '' : t;
}

// 26.4 -> "26s", 1226.25 -> "20m26s", 3723 -> "1h02m03s" (whole seconds, rounded down).
function clockName(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h${String(m).padStart(2, '0')}m${String(r).padStart(2, '0')}s`;
  if (m) return `${m}m${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

// `Title [id] 20m26s-20m29s.mp4`, or `id_start-end.mp4` when the title is unknown.
function clipFileName({ title, id, start, end }) {
  const t = cleanTitle(title);
  if (!t) return `${id}_${start}-${end}.mp4`;
  return `${t} [${id}] ${clockName(start)}-${clockName(end)}.mp4`;
}

function lastLine(text) {
  return String(text || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
}

// Prefer H.264 in mp4 so the segment can be cut by byte range and copied without re-encoding.
// With audio, AAC in m4a goes with it, so the pieces fit into one mp4 without re-encoding the sound.
function formatSelector(height, audio = false) {
  if (!audio) {
    return `bv*[height<=${height}][vcodec^=avc1][ext=mp4]/bv*[height<=${height}][vcodec^=avc1]/bv*[height<=${height}]`;
  }
  return `bv*[height<=${height}][vcodec^=avc1][ext=mp4]+ba[ext=m4a]/bv*[height<=${height}][vcodec^=avc1]+ba[ext=m4a]`
    + `/bv*[height<=${height}]+ba/b[height<=${height}]`;
}

// Downloads random segments (H.264 mp4, silent unless `audio` is set) of the given videos or of a random sample of search results.
//   input: see parseInput, plus `out` (directory, default ./clips)
//   hooks: { onEvent(event), signal, deps }  (deps is for tests: { exec, checkTools, random })
// Events: search, video, skip, segment, progress (downloaded, size, speed, eta; bytes and seconds, null if unknown), retry, clip, warn. Resolves { dir, files, clips }.
async function fetchClips(input, { onEvent, signal, deps = {} } = {}) {
  const opts = parseInput(input);
  const emit = typeof onEvent === 'function' ? onEvent : () => {};
  const run = deps.exec || exec;
  const rng = deps.random || Math.random;
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

  const tools = (deps.checkTools || checkTools)();
  if (tools.missing.length) {
    throw codedError('tools', `Missing required tools: ${tools.missing.join(', ')}. ${tools.hint}`, { missing: tools.missing });
  }
  const step = (cmd, args, extra) => run(cmd, args, { signal, ...extra });

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

      const info = await step('yt-dlp', ['--no-playlist', '--skip-download', '--print', '%(id)s %(duration)s %(title)s', url]);
      const line = info.stdout.split(/\r?\n/).find(Boolean) || '';
      const [, rawId, rawDuration, rawTitle = ''] = line.trim().match(/^(\S+)\s+(\S+)\s*(.*)$/) || [];
      const title = cleanTitle(rawTitle);
      const duration = Math.floor(parseFloat(rawDuration));
      if (info.code !== 0 || !rawId || !(duration > 0)) {
        const reason = info.code !== 0 ? (lastLine(info.stderr) || 'unavailable') : 'no duration (live stream or unavailable)';
        emit({ type: 'skip', index, total, url, reason });
        continue;
      }
      const id = rawId.replace(/[^\w-]/g, '_');
      emit({ type: 'video', index, total, url, id, duration, title });

      const sections = pickSections(duration, opts.per, opts.len, rng);
      for (let k = 0; k < sections.length; k++) {
        const { start, end } = sections[k];
        const stem = `s${index}-${k + 1}`;
        emit({ type: 'segment', index, total, part: k + 1, parts: sections.length, start, end });
        // --downloader native: with --download-sections yt-dlp otherwise hands the job to ffmpeg,
        // which often times out on YouTube. The native downloader fetches just the needed byte range.
        // Even so, a segment sometimes fails for a moment (ffmpeg exit 196 on a dropped connection),
        // so each one gets a few tries.
        let dl;
        let src = null;
        for (let attempt = 1; attempt <= SEGMENT_TRIES; attempt++) {
          for (const f of fs.readdirSync(work)) if (f.startsWith(stem + '.')) fs.rmSync(path.join(work, f), { force: true });
          dl = await step('yt-dlp', [
            '--no-playlist', '-q', '--no-warnings', '--progress', '--newline', '--progress-template', PROGRESS_TEMPLATE,
            '--downloader', 'native',
            '-f', formatSelector(opts.height, opts.audio), '--download-sections', `*${start}-${end}`,
            '-o', path.join(work, `${stem}.%(ext)s`), url,
          ], {
            onStdout: progressReader(p => emit({ type: 'progress', index, total, part: k + 1, parts: sections.length, start, end, ...p })),
          });
          src = dl.code === 0 ? fs.readdirSync(work).find(f => f.startsWith(stem + '.')) : null;
          if (src || attempt === SEGMENT_TRIES) break;
          emit({ type: 'retry', index, part: k + 1, attempt: attempt + 1, attempts: SEGMENT_TRIES, message: lastLine(dl.stderr) });
          await sleep(1500 * attempt);
        }
        if (!src) {
          emit({ type: 'warn', index, url, message: `Segment ${start}-${end} s was not downloaded${dl.code ? ': ' + lastLine(dl.stderr) : ''}` });
          continue;
        }
        const srcPath = path.join(work, src);

        const probe = await step('ffprobe', [
          '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt', '-of', 'csv=p=0', srcPath,
        ]);
        const copy = probe.code === 0 && probe.stdout.trim() === 'h264,yuv420p';
        let file = clipFileName({ title, id, start, end });
        // Two pieces within the same second would get one name; keep both.
        for (let n = 2; files.includes(file); n++) file = clipFileName({ title, id, start, end }).replace(/\.mp4$/, ` (${n}).mp4`);
        const target = path.join(outDir, file);
        const video = copy
          ? ['-c:v', 'copy']
          : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'];

        // Sound: AAC is copied, anything else becomes AAC; a source without sound stays silent (with a warning).
        let sound = ['-an'];
        let withAudio = false;
        if (opts.audio) {
          const aprobe = await step('ffprobe', [
            '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', srcPath,
          ]);
          const acodec = aprobe.code === 0 ? aprobe.stdout.trim() : '';
          if (acodec) {
            sound = acodec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k'];
            withAudio = true;
          } else {
            emit({ type: 'warn', index, url, message: `Segment ${start}-${end} s has no audio track; saved without sound` });
          }
        }
        const maps = withAudio ? ['-map', '0:v:0', '-map', '0:a:0'] : [];
        const enc = await step('ffmpeg', ['-v', 'error', '-y', '-i', srcPath, ...maps, ...video, ...sound, '-movflags', '+faststart', target]);
        fs.rmSync(srcPath, { force: true });
        if (enc.code !== 0) {
          fs.rmSync(target, { force: true });
          emit({ type: 'warn', index, url, message: `ffmpeg failed for segment ${start}-${end} s: ${lastLine(enc.stderr)}` });
          continue;
        }
        const clip = { file, path: target, url, id, title, start, end, audio: withAudio };
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

module.exports = { clipFileName, cleanTitle, fetchClips, checkTools, installHint, exec, formatSelector, parseProgress, progressReader };
