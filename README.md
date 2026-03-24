<div align="center">

<img src="build/icon.png" width="128" alt="ArcDLP icon" />

# ArcDLP

Open-source desktop video downloader powered by
[yt-dlp](https://github.com/yt-dlp/yt-dlp). Paste a URL, pick a quality,
download.

Supports YouTube, Vimeo, Twitter/X, SoundCloud, Instagram, and
[thousands of other sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).

Everything runs locally on your machine - no cloud, no accounts, no tracking.

**[Download](https://github.com/archisvaze/arcdlp/releases/latest)**

</div>

<br/>

<p align="center">
  <img src="screenshots/Screenshot1.png" width="48%" alt="ArcDLP video download" />
  &nbsp;&nbsp;
  <img src="screenshots/Screenshot2.png" width="48%" alt="ArcDLP playlist" />
</p>

## Download & Install

**[Download the latest release](https://github.com/archisvaze/arcdlp/releases/latest)**

Go to the Releases page, scroll down to **Assets**, and click the file for your
system:

- **macOS**: `ArcDLP-x.x.x.dmg`
- **Windows**: `ArcDLP-Setup-x.x.x.exe`
- **Linux**: `ArcDLP-x.x.x.AppImage`

No dependencies to install. yt-dlp and ffmpeg are bundled inside the app.

### macOS

1. Download the `.dmg` file
2. Open it and drag ArcDLP to your Applications folder
3. Open ArcDLP

macOS will show a security warning the first time because the app is not
code-signed yet. This is normal.

To fix it:

1. Click **Done**
2. Open **System Settings**
3. Go to **Privacy & Security**
4. Scroll down and click **Open Anyway** next to ArcDLP
5. Enter your password

You only need to do this once.

### Windows

1. Download and run the `.exe` installer
2. Click **More info**, then click **Run anyway**
3. The installer will set up ArcDLP and create a shortcut automatically

ArcDLP installs per-user (no admin required) and can be uninstalled from
Settings > Apps.

### Linux

1. Download the `.AppImage` file
2. Make it executable: right-click → Properties → Permissions → check **Allow
   executing file as program**
3. Double-click to run

## Features

- **Single video downloads** - Fetch video info, preview metadata, choose
  quality (4K/2K/1080p/720p/480p/360p/240p), and download as MP4 or extract
  audio as MP3
- **Playlist support** - Paste a playlist URL, select which items to download,
  pick a format, and queue them all at once
- **Instagram saved collections** - Paste a saved collection URL, the app scrapes
  all post links from the collection page, and queues them for download
- **Download queue** - Sequential processing with per-item progress, retry,
  cancel, and skip. One failure never stops the rest
- **YouTube sign-in** - Access age-restricted, private, and members-only content
  through a built-in browser login window. Credentials go directly to Google
- **Instagram sign-in** - Access your private saved collections through a
  built-in browser login window. Credentials go directly to Instagram
- **Download history** - Quick access to previously fetched videos with cached
  metadata
- **Multi-site compatibility** - Works with any site yt-dlp supports. Format
  detection adapts automatically to different streaming approaches across sites
- **Update notifications** - The app checks for new releases on startup and lets
  you know when an update is available
- **Light and dark mode** - Follows your system preference. macOS vibrancy
  supported

## Usage

1. Paste a video or playlist URL and click **Fetch**
2. Pick a quality (or choose MP3 for audio extraction)
3. Click **Add to Queue**
4. Downloads are saved to `~/Downloads/ArcDLP` by default (changeable in
   Settings)

For playlists, you can select/deselect individual items and choose a format for
the whole batch before queueing.

To access private or age-restricted YouTube videos, sign in via **Settings >
YouTube Account**. Your credentials go directly to Google through their standard
login page.

### Instagram Saved Collections

yt-dlp supports downloading individual Instagram posts and reels, but it has no
extractor for saved collections. ArcDLP bridges this gap with a built-in scraper.

1. Sign in to Instagram via **Settings > Instagram Account**
2. Paste a saved collection URL (e.g.
   `https://www.instagram.com/username/saved/collection-name/12345/`)
3. Click **Fetch** - the app opens the collection page in a hidden browser
   window using your Instagram session
4. It scrolls through the page, collecting all `<a>` tags with `/p/` and
   `/reel/` href patterns
5. Found posts appear in a playlist-style picker where you can select/deselect
   items
6. Click **Add Selected to Queue** - each post is downloaded individually via
   yt-dlp with your Instagram cookies

The scraper stops after 5 consecutive scrolls with no new posts, or after a
3-minute timeout (partial results are returned if any were found). Large
collections may be rate-limited by Instagram.

## Support the Project

If ArcDLP is useful to you, consider supporting development:

- [Sponsor on GitHub](https://github.com/sponsors/archisvaze)
- [Buy Me a Coffee](https://buymeacoffee.com/archisvaze)

---

## For Developers

Everything below is for people who want to build from source, modify the app, or
contribute.

### Contributing

Contributions are welcome. The codebase is intentionally simple - no frameworks,
no build tools, vanilla JS throughout.

Before making changes, read through the code and match existing patterns. A few
principles the project follows:

- **Keep it simple.** If something can be done in 30 lines, don't use a library.
- **Resilience first.** One failure should never kill the queue. Users should
  always know what's happening.
- **Explicit actions only.** No auto-fetching, no auto-retrying. Every action
  traces to a button click.
- **Let yt-dlp do the work.** Don't reimplement what yt-dlp already handles. The
  app is a GUI wrapper, not a competing tool.
- **Multi-site compatibility.** Never assume YouTube-specific behavior unless
  explicitly scoped. Format detection, error handling, and UI labels should work
  for any site yt-dlp supports.

#### Getting Started

1. Fork and clone the repo
2. `npm install` (downloads yt-dlp + ffmpeg automatically) - See details below
   for Windows and Linux install
3. `npm run dev` to launch with DevTools - See more details below
4. Make your changes, test across a few different sites
5. Open a PR with a clear description of what changed and why

### Build from Source

```bash
git clone https://github.com/archisvaze/arcdlp.git
cd arcdlp
npm install
```

#### Cross-platform builds

To build for a different platform's ffmpeg binary:

### ffmpeg-static Platform Setup

`ffmpeg-static` downloads a platform-specific binary during `npm install`. On
macOS, this works automatically, no setup needed.

On Windows and Linux, set environment variables **before** `npm install` to
ensure the correct binary is downloaded:

**Windows (x64):**

    $env:npm_config_platform = "win32"
    $env:npm_config_arch = "x64"
    rm -r -Force node_modules
    npm install

**Linux (x64):**

    export npm_config_platform=linux
    export npm_config_arch=x64

`ffmpeg-static` only downloads one binary per install, matched to the configured
arch. This means you can't build both x64 and arm64 Linux AppImages from a
single `npm install`

### Development

```bash
npm run dev          # macOS / Linux
npm run dev:win      # Windows
```

This launches the app with DevTools enabled and verbose logging.

### Production Builds

```bash
npm run build:mac      # macOS - produces .dmg and .zip
npm run build:win      # Windows - produces NSIS installer
npm run build:linux    # Linux - produces AppImage
npm run build:all      # All platforms
```

Both yt-dlp and ffmpeg binaries are bundled into the built app via
`extraResources` in package.json.

### Project Structure

```
arcdlp/
├── src/
│   ├── main/
│   │   ├── main.js          # Electron main process, IPC, window, history
│   │   ├── preload.js        # Context bridge (window.api)
│   │   ├── ytdlp.js          # yt-dlp integration: spawn, parse, download
│   │   ├── queue.js          # Sequential download queue with per-item state
│   │   ├── cookies.js        # YouTube + Instagram cookie auth
│   │   ├── scraper.js        # Instagram collection scraper (BrowserWindow)
│   │   ├── updater.js        # Update checker via GitHub Releases API
│   │   └── utils.js          # Dev mode flag, logging helpers
│   └── renderer/
│       ├── index.html        # UI structure
│       ├── renderer.js       # UI logic, state, rendering
│       └── index.css         # All styles
├── scripts/
│   ├── postinstall.js        # Downloads yt-dlp binary on npm install
│   └── fix-ffmpeg-win.js     # Renames ffmpeg for Windows builds
├── bin/                      # yt-dlp binary (auto-populated by postinstall)
├── build/                    # App icons (icon.icns, icon.ico, icon.png)
├── package.json
├── LICENSE
└── README.md
```

### How It Works

1. User pastes a URL and clicks Fetch
2. App spawns `yt-dlp --dump-json` to get video metadata and available formats
3. User picks a quality preset or audio extraction
4. Click "Add to Queue" - the download is queued and processed sequentially
5. yt-dlp handles the actual download with `--progress-template` for structured
   progress output
6. Completed files are saved to the configured download folder

For playlists, the app uses `--flat-playlist --dump-json` to stream items one at
a time, then queues selected items for download.

For Instagram saved collections, the app opens the collection page in a hidden
`BrowserWindow`, scrolls through it collecting anchor tags (`<a href="/p/...">`)
and (`<a href="/reel/...">`) via `executeJavaScript`, then presents the scraped
URLs in the playlist picker UI. Each post is then downloaded individually by
yt-dlp using the Instagram session cookies.

### Dependencies

Only two runtime dependencies:

- **electron-store** - Persistent settings and history
- **ffmpeg-static** - Bundled ffmpeg binary for audio extraction and format
  merging

Dev dependencies: `electron`, `electron-builder`.

yt-dlp handles all downloading, format selection, and ffmpeg orchestration
internally. The app is a GUI wrapper around it.

### Roadmap

ArcDLP covers the core download workflow, but yt-dlp has a huge feature set that
could be surfaced in the GUI. Here's what's planned and where contributors can
help.

#### Quality of Life

- **Thumbnails in playlist items** - The data is already fetched, just not
  rendered yet
- **File size estimates** - Show approximate size on quality presets when
  available
- **Download complete notification** - System notification when the queue
  finishes (only if window is not focused)
- **Playlist fetch cancellation** - Currently can't cancel a playlist fetch
  mid-way through
- **Verbose log toggle** - Clean messages by default, raw yt-dlp output when
  debugging

#### Advanced yt-dlp Features

yt-dlp supports a lot more than basic downloading. These features would make
great contributions:

- **Subtitle downloads** - `--write-subs`, `--sub-langs`, language selection UI
- **Embed metadata** - `--embed-thumbnail`, `--embed-metadata` for tagging files
- **SponsorBlock integration** - `--sponsorblock-remove`, `--sponsorblock-mark`
  to skip or mark sponsored segments
- **Additional audio formats** - AAC, FLAC, WAV, Opus extraction (currently MP3
  only)
- **Format filtering** - Expose yt-dlp's format selection syntax for advanced
  users
- **Download archive** - `--download-archive` to skip already-downloaded videos
- **Rate limiting** - `--limit-rate` for bandwidth control
- **Proxy support** - `--proxy` for users behind restrictive networks
- **Custom output templates** - `--output` template configuration in settings
- **Chapter splitting** - `--split-chapters` to save individual chapters as
  separate files

#### App-Level Features

- **Keyboard shortcuts** - Quick access to common actions
- **More site-specific auth** - Expand the cookie login flow to more sites
  beyond YouTube and Instagram
- **Playlist detection for more sites** - Currently conservative (YouTube,
  SoundCloud, and Instagram saved collections)
- **DOM virtualization for large playlists** - Currently renders all items,
  works fine under ~1000

#### Known Cleanup Items

- `video:fetch` IPC returns the full raw JSON (50-200KB) even in production -
  should be dev-only
- Queue `_items` array has no upper bound - consider a cap or auto-clear
- Playlist checkbox uses inline `onchange` handler - could use event delegation
- Log type detection is greedy (`msg.includes('complete')` matches "incomplete")

## License

[MIT](LICENSE)

## Credits

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - The engine that does all the
  heavy lifting
- [Electron](https://www.electronjs.org/) - Desktop app framework
- [ffmpeg](https://ffmpeg.org/) - Audio/video processing (bundled via
  ffmpeg-static)
- [electron-icon-builder](https://github.com/safu9/electron-icon-builder) - Made icon with Canva and exported the icon files via electron-icon-builder
