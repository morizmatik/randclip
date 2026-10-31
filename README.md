# randclip

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js: LTS](https://img.shields.io/badge/node.js-LTS-339933.svg)

Download random segments of YouTube videos – for sampling, video editing, datasets, references, or anything else that needs many short clips.

Give it a few links, or a search query, and it saves several random, non-overlapping segments from each video as H.264 `.mp4` files. It is a thin, dependency-free layer over [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org/), usable as a command-line tool or as a Node.js library.

```console
$ randclip https://www.youtube.com/watch?v=VIDEO_ID --per 3 --len 4
[1/1] https://www.youtube.com/watch?v=VIDEO_ID (195 s)
  VIDEO_ID_21.37-25.37.mp4
  VIDEO_ID_88.02-92.02.mp4
  VIDEO_ID_153.4-157.4.mp4

Done: 3 clips in clips
```

## Requirements

- [Node.js](https://nodejs.org/) (current LTS)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp), [ffmpeg and ffprobe](https://ffmpeg.org/) on your `PATH`

| System | Install yt-dlp and ffmpeg |
|---|---|
| macOS | `brew install yt-dlp ffmpeg` |
| Windows | `winget install yt-dlp.yt-dlp Gyan.FFmpeg` (or `scoop install yt-dlp ffmpeg`, or `choco install yt-dlp ffmpeg`) |
| Linux | `sudo apt install ffmpeg` and `pipx install yt-dlp` (the distribution package of yt-dlp ages quickly); Arch: `sudo pacman -S yt-dlp ffmpeg` |
| Any | Download the yt-dlp binary from its releases page and put it on your `PATH` |

randclip has no npm dependencies and needs no configuration, accounts or API keys. If a tool is missing, it stops before doing any work and prints the command to install it.

## Install

From a clone of this repository:

```sh
git clone <repository-url> randclip && cd randclip
npm install --global .
```

Or run it without installing: `node bin/randclip --help`.

## Usage

```sh
# Specific videos: 3 random 4-second segments from each
randclip "https://youtu.be/VIDEO_ID" "https://youtu.be/OTHER_ID"

# Random videos from a search: 6 videos, 5 segments of 2 seconds each
randclip --search "skate clips" --count 6 --per 5 --len 2

# A list of links in a file (one per line, # starts a comment)
randclip --file links.txt --out ./samples
```

Quote URLs: `&` and `?` mean something to most shells. A URL without a scheme (`youtu.be/ID`) is accepted.

### Options

| Option | Default | Description |
|---|---|---|
| `-q, --search <text>` | – | Pick random videos from the search results for `<text>` instead of using URLs |
| `-c, --count <n>` | 5 | Videos to take from the search (1–20) |
| `-f, --file <path>` | – | Read URLs from a file, one per line |
| `-n, --per <n>` | 3 | Segments per video (1–10) |
| `-l, --len <seconds>` | 4 | Segment length (1–30) |
| `-H, --height <px>` | 1080 | Maximum video height (240–2160) |
| `-o, --out <dir>` | `./clips` | Output directory, created if needed |
| `--json` | – | Print one JSON event per line (see [events](docs/events.md)) |

Exit codes: `0` success, `1` the run failed (missing tools, nothing downloaded), `2` invalid usage, `130` canceled with Ctrl+C. More in [docs/cli.md](docs/cli.md).

### Output

Segments are written as `<video id>_<start>-<end>.mp4`, for example `VIDEO_ID_21.37-25.37.mp4` (start and end in seconds). They are H.264, **without audio**, so they can be dropped straight into most editors and samplers. Segments of one video never overlap. A video shorter than the segment length is saved whole.

## Use as a library

```js
const { fetchClips } = require('randclip');

const { dir, files, clips } = await fetchClips(
  { urls: ['https://youtu.be/VIDEO_ID'], per: 3, len: 4, out: './clips' },
  { onEvent: event => console.log(event.type) },
);
```

`fetchClips` accepts an `AbortSignal` for cancellation and reports progress through `onEvent`. Full reference: [docs/api.md](docs/api.md).

## Use from other languages

Run the CLI with `--json` and read its output line by line – each line is one JSON event. This works from Swift, Python, shell scripts, or anything that can start a process. See [docs/events.md](docs/events.md) and [examples/](examples/).

## Troubleshooting

- **It stopped working or fails for every video.** YouTube changes often, and yt-dlp follows. Update it first: `brew upgrade yt-dlp`, `winget upgrade yt-dlp.yt-dlp`, or `pipx upgrade yt-dlp`.
- **"Sign in to confirm you're not a bot".** YouTube is rejecting the request. This comes from YouTube and yt-dlp, not from randclip; see the yt-dlp documentation for cookies and other options.
- **A video is skipped.** It is private, region-locked, age-restricted, a live stream, or has no duration. The reason is printed and the run continues with the rest.

## Platform support

Developed and tested on macOS. The code uses no shell and no platform-specific paths, and is intended to work the same on Linux and Windows, but those systems have not been tested yet. The tests use fake `yt-dlp` and `ffmpeg`, so they need no network and run anywhere: `npm test`.

## Responsible use

Downloading videos from YouTube may violate its Terms of Service, and the videos are protected by copyright. Use randclip only on videos you own, that are licensed for reuse, or that you otherwise have the right to download and use. You are responsible for how you use the tool and the clips it produces. randclip is not affiliated with or endorsed by YouTube or Google.

## License

[MIT](LICENSE)
