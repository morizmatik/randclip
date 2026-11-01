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
{"type":"video","index":1,"total":3,"url":"https://www.youtube.com/watch?v=VIDEO_ID","id":"VIDEO_ID","duration":195,"title":"Soul Train 1974"}
```

`title` is the video title cleaned for use in file names (no `/ : * ? " < > | [ ]`, at most 80 characters); `""` when yt-dlp gives none.

## `skip`

A video was skipped (unavailable, private, live, no duration).

```json
{"type":"skip","index":2,"total":3,"url":"https://youtu.be/OTHER_ID","reason":"ERROR: Video unavailable"}
```

## `segment`

A segment is about to be downloaded. `part` of `parts` counts the segments of this video.

```json
{"type":"segment","index":1,"total":3,"part":2,"parts":3,"start":21.37,"end":25.37}
```

## `retry`

A segment download failed and is being tried again (each segment gets three tries). `attempt` is the number of the try that is about to start.

```json
{"type":"retry","index":1,"part":2,"attempt":2,"attempts":3,"message":"ERROR: ffmpeg exited with code 196"}
```

## `clip`

A segment was written.

```json
{"type":"clip","index":1,"total":3,"file":"Soul Train 1974 [VIDEO_ID] 0m21s-0m25s.mp4","path":"/abs/clips/Soul Train 1974 [VIDEO_ID] 0m21s-0m25s.mp4","url":"https://www.youtube.com/watch?v=VIDEO_ID","id":"VIDEO_ID","title":"Soul Train 1974","start":21.37,"end":25.37,"audio":false}
```

The file is named `<title> [<id>] <start>-<end>.mp4` with whole-second times such as `20m26s` (`1h02m03s` past an hour). Without a title it is `<id>_<start>-<end>.mp4` (seconds).

`audio` is `true` when the file carries sound (only with `--audio`, and only if the video has an audio track).

## `warn`

One segment failed (after its retries) or was saved with a limitation (for example, no audio track although `--audio` was given); the run continues.

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
