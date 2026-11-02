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
      return { code: 0, stdout: `${v.id} ${v.duration}${v.title ? ' ' + v.title : ''}\n`, stderr: '' };
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
    { onEvent: e => events.push(e), deps: { exec: fakeExec(videos), checkTools: allTools, sleep: async () => {} } },
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

test('a segment that fails once is retried, and progress events come in order', async () => {
  const out = tmp();
  const events = [];
  const inner = fakeExec({ 'https://youtu.be/flaky': { id: 'flaky', duration: 30 } });
  let downloads = 0;
  const exec = async (cmd, args, o) => {
    if (cmd === 'yt-dlp' && args.includes('--download-sections') && ++downloads === 1) {
      return { code: 1, stdout: '', stderr: 'ERROR: ffmpeg exited with code 196\n' };
    }
    return inner(cmd, args, o);
  };
  const res = await fetchClips(
    { urls: ['https://youtu.be/flaky'], per: 1, out },
    { onEvent: e => events.push(e), deps: { exec, checkTools: allTools, sleep: async () => {} } },
  );
  assert.equal(res.files.length, 1);
  assert.deepEqual(events.map(e => e.type), ['video', 'segment', 'retry', 'clip']);
  assert.equal(events[1].parts, 1);
  assert.match(events[2].message, /196/);
  assert.equal(events[2].attempt, 2);
  assert.equal(events.filter(e => e.type === 'warn').length, 0);
});

test('a segment that keeps failing is tried three times, then warned about', async () => {
  const out = tmp();
  const events = [];
  const videos = { 'https://youtu.be/bad': { id: 'bad', duration: 30, failDownload: true }, 'https://youtu.be/ok': { id: 'ok', duration: 30 } };
  await fetchClips(
    { urls: ['https://youtu.be/bad', 'https://youtu.be/ok'], per: 1, out },
    { onEvent: e => events.push(e), deps: { exec: fakeExec(videos), checkTools: allTools, sleep: async () => {} } },
  );
  assert.equal(events.filter(e => e.type === 'retry').length, 2);
  assert.equal(events.filter(e => e.type === 'warn').length, 1);
});

test('clips are named after the video title and the time range', async () => {
  const out = tmp();
  const events = [];
  const res = await fetchClips(
    { urls: ['https://youtu.be/t'], per: 1, len: 3, out },
    { onEvent: e => events.push(e), deps: { exec: fakeExec({ 'https://youtu.be/t': { id: 't', duration: 3000, title: 'Soul: Train/1974 [live]' } }), checkTools: allTools, random: () => 0.5 } },
  );
  assert.match(res.files[0], /^Soul Train 1974 live \[t\] \d+m\d\ds-\d+m\d\ds\.mp4$/);
  assert.ok(fs.existsSync(path.join(out, res.files[0])));
  assert.equal(events.find(e => e.type === 'video').title, 'Soul Train 1974 live');
  assert.equal(events.find(e => e.type === 'clip').title, 'Soul Train 1974 live');
});

test('clipFileName: time formats, long titles, missing title', () => {
  const { clipFileName } = require('../src/engine');
  assert.equal(clipFileName({ title: 'A', id: 'x', start: 1226.25, end: 1229.25 }), 'A [x] 20m26s-20m29s.mp4');
  assert.equal(clipFileName({ title: 'A', id: 'x', start: 3723, end: 3726 }), 'A [x] 1h02m03s-1h02m06s.mp4');
  assert.equal(clipFileName({ title: 'A', id: 'x', start: 5, end: 9 }), 'A [x] 5s-9s.mp4');
  assert.equal(clipFileName({ title: '', id: 'x', start: 1.5, end: 5.5 }), 'x_1.5-5.5.mp4');
  assert.equal(clipFileName({ title: 'NA', id: 'x', start: 1, end: 5 }), 'x_1-5.mp4');
  assert.ok(clipFileName({ title: 'z'.repeat(300), id: 'x', start: 1, end: 5 }).length < 110);
});

test('parseProgress reads the yt-dlp template line and tolerates unknown values', () => {
  const { parseProgress } = require('../src/engine');
  assert.deepEqual(parseProgress('RC-PROGRESS 1000 4000 NA 250000.5 12'), { downloaded: 1000, size: 4000, speed: 250000.5, eta: 12 });
  assert.deepEqual(parseProgress('RC-PROGRESS 500 NA 2000 NA NA'), { downloaded: 500, size: 2000, speed: null, eta: null });
  assert.equal(parseProgress('[download] 10%'), null);
  assert.equal(parseProgress('RC-PROGRESS NA NA NA NA NA'), null);
});

test('progressReader joins split chunks and throttles updates, but always passes the last one', () => {
  const { progressReader } = require('../src/engine');
  const got = [];
  let t = 0;
  const feed = progressReader(p => got.push(p), { now: () => t, every: 500 });
  feed('RC-PROGRESS 100 1000 NA 50 9\nRC-PRO');
  t = 100; feed('GRESS 200 1000 NA 60 8\n');
  t = 600; feed('RC-PROGRESS 300 1000 NA 70 7\nRC-PROGRESS 1000 1000 NA 70 0\n');
  assert.deepEqual(got.map(p => p.downloaded), [100, 300, 1000]);
});

test('download progress reaches the events with segment numbers', async () => {
  const out = tmp();
  const events = [];
  const inner = fakeExec({ 'https://youtu.be/prog': { id: 'prog', duration: 30 } });
  const exec = async (cmd, args, o) => {
    if (cmd === 'yt-dlp' && args.includes('--download-sections')) {
      assert.ok(args.includes('--progress-template'));
      o.onStdout('RC-PROGRESS 2048 8192 NA 1024 6\n');
    }
    return inner(cmd, args, o);
  };
  await fetchClips({ urls: ['https://youtu.be/prog'], per: 1, out }, { onEvent: e => events.push(e), deps: { exec, checkTools: allTools } });
  const p = events.find(e => e.type === 'progress');
  assert.equal(p.part, 1);
  assert.equal(p.parts, 1);
  assert.equal(p.index, 1);
  assert.equal(p.total, 1);
  assert.equal(p.downloaded, 2048);
  assert.equal(p.speed, 1024);
});
