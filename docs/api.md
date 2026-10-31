# Library API

```js
const randclip = require('randclip');
```

CommonJS, no dependencies. All functions are also available from their modules in `src/`.

## `fetchClips(input, hooks?) → Promise<{ dir, files, clips }>`

Downloads random segments and writes them to the output directory.

`input`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `urls` | `string[]` | – | Video URLs |
| `text` | `string` | – | URLs, one per line; `#` starts a comment (combined with `urls`) |
| `query` | `string` | – | Search query; use instead of `urls`/`text` |
| `count` | integer | 5 | Videos taken from the search |
| `per` | integer | 3 | Segments per video |
| `len` | integer | 4 | Segment length, seconds |
| `height` | integer | 1080 | Maximum video height |
| `out` | `string` | `./clips` | Output directory |

`hooks`:

| Field | Meaning |
|---|---|
| `onEvent(event)` | Called for each progress event, see [events](events.md) |
| `signal` | An `AbortSignal`; aborting stops running processes and rejects with `code: 'aborted'` |

Result: `dir` is the absolute output directory; `files` are the file names written by this call; `clips` has one object per file: `{ file, path, url, id, start, end }`.

Errors carry a `code`:

| `code` | Cause |
|---|---|
| `empty`, `conflict`, `long`, `tooMany`, `notUrl`, `queryLong`, `per`, `len`, `height`, `count` | Invalid input (the error is an `InputError`) |
| `tools` | yt-dlp, ffmpeg or ffprobe missing; `error.missing` lists them and the message includes the install command |
| `search` | The search request failed |
| `nothing` | No search results, or no clip was produced |
| `aborted` | Canceled through `signal` |

## `checkTools() → { ytdlp, ffmpeg, ffprobe, missing, hint }`

Runs each tool and reports whether it works. `missing` lists the names that do not; `hint` is an install command for the current system (empty when nothing is missing).

## `parseInput(input) → { mode, urls, query, per, len, height, count }`

Validates and normalizes an input object the same way `fetchClips` does. Throws `InputError`. `DEFAULTS` and `LIMITS` expose the default values and ranges; `parseList(text)` splits a list of lines.

## `pickSections(duration, count, len, rng?) → [{ start, end }]`

Random, ordered, non-overlapping segments inside a video of `duration` seconds. `rng` is a function returning a number in `[0, 1)` (default `Math.random`).

## `createJobs({ runner, keep?, now? })`

A small queue for services that start fetches on request: one job at a time, a numbered event log, cancellation.

```js
const jobs = createJobs({
  runner: (input, emit, signal) => randclip.fetchClips(input, { onEvent: emit, signal }),
});

const job = jobs.start({ urls: ['https://youtu.be/VIDEO_ID'] }); // throws { code: 'busy' } if one is running
jobs.get(job.id, 0);   // { id, state, events, total, dir, files, error, startedAt, endedAt }
jobs.cancel(job.id);
```

`state` is `running`, `done`, `canceled` or `error`. Pass the number of events already seen as the second argument of `get` to receive only new ones. The queue appends a final `done`, `canceled` or `error` event itself. The last `keep` jobs (default 10) are remembered.
