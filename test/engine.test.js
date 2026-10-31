'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fetchClips, checkTools, installHint, exec } = require('../src/engine');

const allTools = () => ({ ytdlp: true, ffmpeg: true, ffprobe: true, missing: [], hint: '' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'randclip-test-'));

// A fake exec: yt-dlp, ffprobe and ffmpeg are scripted by a table of videos.
function fakeExec(videos, log = []) {
  return async (cmd, args, { signal } = {}) => {
    if (signal && signal.aborted) throw Object.assign(new Error('Aborted.'), { name: 'AbortError', code: 'aborted' });
    log.push([cmd, ...args]);
    const url = args[args.length - 1];
    if (cmd === 'yt-dlp' && args.includes('--skip-download')) {
      const v = videos[url];
      if (!v) return { code: 1, stdout: '', stderr: 'ERROR: Video unavailable\n' };
      return { code: 0, stdout: `${v.id} ${v.duration}\n`, stderr: '' };
    }
    if (cmd === 'yt-dlp' && args[0] === '--flat-playlist') {
      return { code: 0, stdout: Object.keys(videos).join('\n') + '\n', stderr: '' };
    }
    if (cmd === 'yt-dlp') {
      const template = args[args.indexOf('-o') + 1];
      const v = videos[url];
      if (v.failDownload) return { code: 1, stdout: '', stderr: 'ERROR: timed out\n' };
      fs.writeFileSync(template.replace('%(ext)s', 'mp4'), 'src');
      return { code: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'ffprobe') {
      const v = Object.values(videos).find(x => x.codec || x.acodec !== undefined) || {};
      if (args.includes('a:0')) return { code: 0, stdout: v.acodec === undefined ? 'aac' : v.acodec, stderr: '' };
      return { code: 0, stdout: v.codec || 'h264,yuv420p', stderr: '' };
    }
    if (cmd === 'ffmpeg') {
      fs.writeFileSync(args[args.length - 1], 'out');
      return { code: 0, stdout: '', stderr: '' };
    }
    throw new Error('unexpected command ' + cmd);
  };
}

test('links mode: events, files and copy without re-encoding', async () => {
  const out = tmp();
  const log = [];
  const events = [];
  const res = await fetchClips(
    { urls: ['https://youtu.be/aaaaaaaaaaa'], per: 2, len: 4, out },
    { onEvent: e => events.push(e), deps: { exec: fakeExec({ 'https://youtu.be/aaaaaaaaaaa': { id: 'aaaaaaaaaaa', duration: 60 } }, log), checkTools: allTools, random: () => 0 } },
  );
  assert.equal(res.files.length, 2);
  assert.deepEqual(res.files, ['aaaaaaaaaaa_0-4.mp4', 'aaaaaaaaaaa_4-8.mp4']);
  for (const f of res.files) assert.ok(fs.existsSync(path.join(out, f)));
  assert.equal(events[0].type, 'video');
  assert.equal(events.filter(e => e.type === 'clip').length, 2);
  const enc = log.find(a => a[0] === 'ffmpeg');
  assert.ok(enc.includes('copy') && !enc.includes('libx264'), 'h264 is copied');
  assert.ok(enc.includes('-an'), 'audio is dropped');
  const dl = log.find(a => a[0] === 'yt-dlp' && a.includes('--download-sections'));
  assert.equal(dl[dl.indexOf('--download-sections') + 1], '*0-4');
  assert.ok(dl.includes('--downloader') && dl.includes('native'));
});

test('other codecs are re-encoded with libx264', async () => {
  const out = tmp();
  const log = [];
  await fetchClips(
    { urls: ['https://youtu.be/bbbbbbbbbbb'], per: 1, out },
    { deps: { exec: fakeExec({ 'https://youtu.be/bbbbbbbbbbb': { id: 'bbbbbbbbbbb', duration: 30, codec: 'vp9,yuv420p' } }, log), checkTools: allTools } },
  );
  assert.ok(log.find(a => a[0] === 'ffmpeg').includes('libx264'));
});

test('unavailable videos are skipped, failed segments produce a warning', async () => {
  const out = tmp();
  const events = [];
  const videos = {
    'https://youtu.be/ok': { id: 'ok', duration: 30 },
    'https://youtu.be/bad': { id: 'bad', duration: 30, failDownload: true },
  };
  const res = await fetchClips(
    { urls: ['https://youtu.be/gone', 'https://youtu.be/bad', 'https://youtu.be/ok'], per: 1, out },
    { onEvent: e => events.push(e), deps: { exec: fakeExec(videos), checkTools: allTools } },
  );
  assert.equal(res.files.length, 1);
  assert.equal(events.filter(e => e.type === 'skip').length, 1);
  assert.match(events.find(e => e.type === 'skip').reason, /unavailable/);
  assert.match(events.find(e => e.type === 'warn').message, /timed out/);
});

test('search mode picks the requested number of videos', async () => {
  const out = tmp();
  const videos = {};
  for (let i = 1; i <= 6; i++) videos[`https://youtu.be/v${i}`] = { id: `v${i}`, duration: 30 };
  const events = [];
  const res = await fetchClips(
    { query: 'skate clips', count: 2, per: 1, out },
    { onEvent: e => events.push(e), deps: { exec: fakeExec(videos), checkTools: allTools } },
  );
  assert.equal(events[0].type, 'search');
  assert.equal(events[0].picked, 2);
  assert.equal(res.files.length, 2);
});

test('nothing produced is an error', async () => {
  const out = tmp();
  await assert.rejects(
    fetchClips({ urls: ['https://youtu.be/gone'], out }, { deps: { exec: fakeExec({}), checkTools: allTools } }),
    { code: 'nothing' },
  );
});

test('missing tools stop the run before any work and name the fix', async () => {
  const out = path.join(tmp(), 'never-created');
  await assert.rejects(
    fetchClips({ urls: ['https://youtu.be/x'], out }, {
      deps: { checkTools: () => ({ ytdlp: false, ffmpeg: true, ffprobe: true, missing: ['yt-dlp'], hint: 'Install them with: brew install yt-dlp ffmpeg' }) },
    }),
    err => err.code === 'tools' && /yt-dlp/.test(err.message) && /brew install/.test(err.message) && err.missing[0] === 'yt-dlp',
  );
  assert.equal(fs.existsSync(out), false, 'no output directory is created');
});

test('invalid input is rejected before anything runs', async () => {
  await assert.rejects(fetchClips({ urls: ['nonsense'] }), { code: 'notUrl' });
});

test('abort stops the run', async () => {
  const out = tmp();
  const ctrl = new AbortController();
  const videos = { 'https://youtu.be/a': { id: 'a', duration: 60 } };
  const base = fakeExec(videos);
  const run = async (cmd, args, opts) => {
    if (cmd === 'yt-dlp' && args.includes('--download-sections')) ctrl.abort();
    return base(cmd, args, opts);
  };
  await assert.rejects(
    fetchClips({ urls: ['https://youtu.be/a'], per: 3, out }, { signal: ctrl.signal, deps: { exec: run, checkTools: allTools } }),
    { code: 'aborted' },
  );
});

test('the temporary work directory is removed', async () => {
  const before = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('randclip-') && !n.startsWith('randclip-test-'));
  await fetchClips({ urls: ['https://youtu.be/a'], per: 1, out: tmp() }, {
    deps: { exec: fakeExec({ 'https://youtu.be/a': { id: 'a', duration: 30 } }), checkTools: allTools },
  });
  const after = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('randclip-') && !n.startsWith('randclip-test-'));
  assert.equal(after.length, before.length);
});

test('checkTools reports a tool as missing when it cannot run or exits non-zero', () => {
  const run = cmd => (cmd === 'yt-dlp' ? { error: new Error('ENOENT') } : cmd === 'ffprobe' ? { status: 1 } : { status: 0 });
  const r = checkTools({ run, platform: 'win32' });
  assert.deepEqual(r.missing, ['yt-dlp', 'ffprobe']);
  assert.equal(r.ffmpeg, true);
  assert.match(r.hint, /winget/);
  assert.equal(checkTools({ run: () => ({ status: 0 }) }).missing.length, 0);
});

test('install hints exist for every platform', () => {
  assert.match(installHint('darwin'), /brew/);
  assert.match(installHint('win32'), /winget/);
  assert.match(installHint('linux'), /pipx/);
});

test('exec runs a real process, reports a failing one, and kills one on abort', async () => {
  const ok = await exec(process.execPath, ['-e', 'console.log("hi")']);
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout.trim(), 'hi');
  const bad = await exec(process.execPath, ['-e', 'console.error("boom"); process.exit(3)']);
  assert.equal(bad.code, 3);
  assert.match(bad.stderr, /boom/);
  await assert.rejects(exec('randclip-no-such-command', []), { code: 'ENOENT' });
  const ctrl = new AbortController();
  const started = Date.now();
  const pending = exec(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 100);
  await assert.rejects(pending, { code: 'aborted' });
  assert.ok(Date.now() - started < 5000, 'the process was killed');
});

test('audio: AAC is copied together with the video, formats ask for audio', async () => {
  const log = [];
  const events = [];
  await fetchClips(
    { urls: ['https://youtu.be/aud'], per: 1, audio: true, out: tmp() },
    { onEvent: e => events.push(e), deps: { exec: fakeExec({ 'https://youtu.be/aud': { id: 'aud', duration: 30 } }, log), checkTools: allTools } },
  );
  const dl = log.find(a => a[0] === 'yt-dlp' && a.includes('--download-sections'));
  assert.match(dl[dl.indexOf('-f') + 1], /\+ba/);
  const enc = log.find(a => a[0] === 'ffmpeg');
  assert.ok(!enc.includes('-an'), 'sound is kept');
  assert.equal(enc[enc.indexOf('-c:a') + 1], 'copy');
  assert.ok(enc.includes('-map') && enc.includes('0:a:0'));
  assert.equal(events.find(e => e.type === 'clip').audio, true);
});

test('audio: other sound codecs become AAC', async () => {
  const log = [];
  await fetchClips(
    { urls: ['https://youtu.be/opus'], per: 1, audio: true, out: tmp() },
    { deps: { exec: fakeExec({ 'https://youtu.be/opus': { id: 'opus', duration: 30, codec: 'vp9,yuv420p', acodec: 'opus' } }, log), checkTools: allTools } },
  );
  const enc = log.find(a => a[0] === 'ffmpeg');
  assert.equal(enc[enc.indexOf('-c:a') + 1], 'aac');
  assert.ok(enc.includes('libx264'));
});

test('audio: a source without sound is saved silent with a warning', async () => {
  const log = [];
  const events = [];
  await fetchClips(
    { urls: ['https://youtu.be/mute'], per: 1, audio: true, out: tmp() },
    { onEvent: e => events.push(e), deps: { exec: fakeExec({ 'https://youtu.be/mute': { id: 'mute', duration: 30, acodec: '' } }, log), checkTools: allTools } },
  );
  assert.ok(log.find(a => a[0] === 'ffmpeg').includes('-an'));
  assert.match(events.find(e => e.type === 'warn').message, /no audio track/);
  assert.equal(events.find(e => e.type === 'clip').audio, false);
});

test('without audio the format has no audio part and sound is dropped', async () => {
  const log = [];
  await fetchClips(
    { urls: ['https://youtu.be/q'], per: 1, out: tmp() },
    { deps: { exec: fakeExec({ 'https://youtu.be/q': { id: 'q', duration: 30 } }, log), checkTools: allTools } },
  );
  const dl = log.find(a => a[0] === 'yt-dlp' && a.includes('--download-sections'));
  assert.doesNotMatch(dl[dl.indexOf('-f') + 1], /\+ba/);
  assert.ok(log.find(a => a[0] === 'ffmpeg').includes('-an'));
  assert.ok(!log.some(a => a[0] === 'ffprobe' && a.includes('a:0')), 'sound is not probed');
});
