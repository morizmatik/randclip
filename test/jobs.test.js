'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobs } = require('../src/jobs');

const tick = () => new Promise(r => setTimeout(r, 0));
const until = async (fn, ms = 500) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await tick(); }
  return false;
};
let clock = 1000;
const now = () => (clock += 10);

test('a job runs, shows events while running and ends in done', async () => {
  let release;
  const runner = (opts, emit) => new Promise(res => {
    emit({ type: 'video', index: 1 });
    release = () => res({ dir: '/out', files: ['a.mp4'] });
  });
  const jobs = createJobs({ runner, now });
  const job = jobs.start({});
  assert.equal(job.state, 'running');
  await tick();
  assert.equal(jobs.get(job.id).events[0].type, 'video');
  release();
  await until(() => jobs.get(job.id).state !== 'running');
  const done = jobs.get(job.id);
  assert.equal(done.state, 'done');
  assert.deepEqual(done.files, ['a.mp4']);
  assert.equal(done.events.at(-1).type, 'done');
  assert.equal(jobs.get(job.id, 1).events.length, done.events.length - 1, 'cursor');
  assert.equal(jobs.busy(), false);
});

test('a second job is refused while one is running', () => {
  const jobs = createJobs({ runner: () => new Promise(() => {}), now });
  jobs.start({});
  assert.throws(() => jobs.start({}), { code: 'busy' });
});

test('cancel aborts the runner signal', async () => {
  const runner = (opts, emit, signal) => new Promise((res, rej) => {
    signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const jobs = createJobs({ runner, now });
  const job = jobs.start({});
  await tick();
  jobs.cancel(job.id);
  await until(() => jobs.get(job.id).state !== 'running');
  assert.equal(jobs.get(job.id).state, 'canceled');
  assert.equal(jobs.cancel('nope'), null);
  assert.equal(jobs.get('nope'), null);
});

test('a runner error is visible in the job', async () => {
  const jobs = createJobs({ runner: async () => { throw new Error('no network'); }, now });
  const job = jobs.start({});
  await until(() => jobs.get(job.id).state !== 'running');
  assert.equal(jobs.get(job.id).state, 'error');
  assert.match(jobs.get(job.id).error, /no network/);
});

test('old jobs are dropped', async () => {
  const jobs = createJobs({ runner: async () => ({ dir: '/d', files: [] }), now, keep: 2 });
  const first = jobs.start({});
  for (let i = 0; i < 3; i++) { await tick(); jobs.start({}); }
  await tick();
  assert.equal(jobs.get(first.id), null);
});

test('createJobs requires a runner', () => {
  assert.throws(() => createJobs({}), TypeError);
});
