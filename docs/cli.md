# Command line

```
randclip [options] <url>...
randclip [options] --search "<query>"
randclip [options] --file links.txt
```

Give URLs, a search query, or a file – not a mix of URLs and a query. URLs from arguments and from `--file` are combined (at most 20).

## Options

| Option | Default | Range | Meaning |
|---|---|---|---|
| `-q, --search <text>` | – | up to 120 characters | Take random videos from the first `3 × count` search results |
| `-c, --count <n>` | 5 | 1–20 | Number of videos taken from the search |
| `-f, --file <path>` | – | – | File with one URL per line; text after `#` is a comment |
| `-n, --per <n>` | 3 | 1–10 | Segments per video |
| `-l, --len <seconds>` | 4 | 1–30 | Length of one segment |
| `-H, --height <px>` | 1080 | 240–2160 | Maximum video height; the best H.264 stream up to this height is preferred |
| `-o, --out <dir>` | `./clips` | – | Output directory, created if needed; existing files with the same name are overwritten |
| `--audio` | off | – | Keep the sound; without it clips are silent |
| `--json` | – | – | One JSON event per line on stdout instead of text |
| `-h, --help` | – | – | Usage |
| `-v, --version` | – | – | Version |

Values outside a range are rejected with exit code 2 before anything is downloaded.

## Output

Text mode prints progress to stdout and warnings and skipped videos to stderr. Files are named `<video id>_<start>-<end>.mp4`. Segments are H.264, yuv420p, without audio. When the downloaded stream is already H.264, it is copied without re-encoding; otherwise it is re-encoded with `libx264` (`-preset veryfast -crf 18`).

With `--audio`, the best AAC (m4a) audio is downloaded along with the video and kept in the mp4. AAC is copied; any other audio codec is converted to AAC at 192 kbit/s. Audio and video are cut at the same moments but not always to the exact same length (the audio can be a fraction of a second shorter). If a video has no audio track, that segment is saved silent and a `warn` event is reported.

Segment positions are chosen by splitting the free time in the video with random points, so segments are ordered, do not overlap, and are spread over the whole video.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | At least one clip was written |
| 1 | The run failed: required tools missing, search failed, nothing was downloaded |
| 2 | Invalid usage or input |
| 130 | Canceled with Ctrl+C (running yt-dlp and ffmpeg processes are stopped) |

## Required tools

`yt-dlp`, `ffmpeg` and `ffprobe` must run from `PATH`. The check happens first; if something is missing, randclip exits with code 1 and prints the install command for your system.
