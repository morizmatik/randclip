'use strict';

// A queue for long-running fetches: one job at a time, numbered events, cancellation.
// Pure: no HTTP and no processes. The runner is passed in, e.g. (opts, emit, signal) => fetchClips(...).
function createJobs({ runner, now = Date.now, keep = 10 } = {}) {
  if (typeof runner !== 'function') throw new TypeError('createJobs needs a runner function');
  const jobs = new Map();
  const order = [];
  let current = null;
  let seq = 0;

  function snapshot(job, from = 0) {
    return {
      id: job.id, state: job.state, events: job.events.slice(from), total: job.events.length,
      dir: job.dir, files: job.files, error: job.error, startedAt: job.startedAt, endedAt: job.endedAt,
    };
  }

  function prune() {
    while (order.length > keep) {
      const id = order[0];
      if (jobs.get(id) && jobs.get(id).state === 'running') break;
      order.shift();
      jobs.delete(id);
    }
  }

  function start(opts) {
    if (current && current.state === 'running') {
      throw Object.assign(new Error('A job is already running.'), { code: 'busy' });
    }
    const job = {
      id: 'j' + now().toString(36) + '-' + (++seq), state: 'running', events: [], dir: null, files: [],
      error: null, startedAt: now(), endedAt: null, ctrl: new AbortController(),
    };
    jobs.set(job.id, job);
    order.push(job.id);
    current = job;

    const emit = event => { if (event && typeof event === 'object') job.events.push(event); };
    const finish = () => { job.endedAt = now(); prune(); };

    Promise.resolve()
      .then(() => runner(opts, emit, job.ctrl.signal))
      .then(res => {
        job.dir = (res && res.dir) || null;
        job.files = (res && res.files) || [];
        job.state = job.ctrl.signal.aborted ? 'canceled' : 'done';
        job.events.push(job.state === 'done' ? { type: 'done', files: job.files.length, dir: job.dir } : { type: 'canceled' });
      })
      .catch(err => {
        if (job.ctrl.signal.aborted) {
          job.state = 'canceled';
          job.events.push({ type: 'canceled' });
        } else {
          job.state = 'error';
          job.error = String((err && err.message) || err);
          job.events.push({ type: 'error', message: job.error });
        }
      })
      .finally(finish);
    return snapshot(job);
  }

  function get(id, from = 0) {
    const job = jobs.get(id);
    return job ? snapshot(job, Math.max(0, Math.floor(from) || 0)) : null;
  }

  function cancel(id) {
    const job = jobs.get(id);
    if (!job) return null;
    if (job.state === 'running') job.ctrl.abort();
    return snapshot(job);
  }

  return { start, get, cancel, busy: () => !!(current && current.state === 'running') };
}

module.exports = { createJobs };
