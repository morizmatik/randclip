# Events

`fetchClips` reports progress through `onEvent`; `randclip --json` prints the same events, one JSON object per line on stdout. Every event has a `type`.

## `search`

Only in search mode, once.

```json
{"type":"search","query":"skate clips","found":15,"picked":5}
```

## `video`

A video was found and its segments will be downloaded.

```json
{"type":"video","index":1,"total":3,"url":"https://www.youtube.com/watch?v=VIDEO_ID","id":"VIDEO_ID","duration":195}
```

## `skip`

A video was skipped (unavailable, private, live, no duration).

```json
{"type":"skip","index":2,"total":3,"url":"https://youtu.be/OTHER_ID","reason":"ERROR: Video unavailable"}
```

## `clip`

A segment was written.

```json
{"type":"clip","index":1,"total":3,"file":"VIDEO_ID_21.37-25.37.mp4","path":"/abs/clips/VIDEO_ID_21.37-25.37.mp4","url":"https://www.youtube.com/watch?v=VIDEO_ID","id":"VIDEO_ID","start":21.37,"end":25.37,"audio":false}
```

`audio` is `true` when the file carries sound (only with `--audio`, and only if the video has an audio track).

## `warn`

One segment failed or was saved with a limitation (for example, no audio track although `--audio` was given); the run continues.

```json
{"type":"warn","index":1,"url":"https://www.youtube.com/watch?v=VIDEO_ID","message":"Segment 21.37-25.37 s was not downloaded: ERROR: timed out"}
```

## Final events

`fetchClips` resolves or rejects instead of emitting a final event. `randclip --json` ends its output with exactly one of these:

```json
{"type":"done","dir":"/abs/clips","files":3}
{"type":"canceled"}
{"type":"error","code":"tools","message":"Missing required tools: yt-dlp. Install them with: brew install yt-dlp ffmpeg"}
```

`createJobs` adds the same final events (`done`, `canceled`, `error`) to a job's event list.
