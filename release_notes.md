## ArcDLP v1.3.7

### ⚠️ If you are getting errors on YouTube

Before anything else, go to:

**Settings → Reset app (clear cache)**

Then restart and try again.

This fixes most issues caused by stale cookies or corrupted session data.

---

### Fixed: YouTube downloads broken in packaged app

This was the big one. YouTube downloads worked perfectly in development but failed in production builds with "Requested format is not available" - returning only storyboard thumbnails instead of actual video/audio streams.

**Root cause:** yt-dlp 2026 relies on Deno to solve YouTube's anti-bot JS challenges. In development, Deno was available on the system PATH. But macOS apps launched from Finder don't inherit shell PATH, so the packaged app couldn't find Deno. Without it, yt-dlp fell back to degraded API clients (the "tv downgraded player") that return empty format lists.

**Fix:** Deno is now bundled with the app alongside yt-dlp and ffmpeg. The bundled Deno directory is injected into PATH when spawning yt-dlp, so JS challenge solving works regardless of how the app is launched.

---

### New

- **Bundled Deno runtime.**
  Deno is now downloaded automatically during `npm install` and shipped inside the app as a production dependency. No system installation required.

- **Added: OPUS audio download option.**
  You can now download audio directly as OPUS in addition to MP3.
  OPUS provides better quality at smaller file sizes and avoids unnecessary re-encoding in many cases.

---

### Improvements

- **Updated build pipeline.**
  The afterPack script now strips macOS quarantine attributes and ensures execute permissions on all bundled binaries (yt-dlp, ffmpeg, deno).

- **Dependency checker updated.**
  The startup dep check now reports Deno status alongside yt-dlp and ffmpeg.

- **Added `--no-check-formats` to info fetches.**
  Prevents yt-dlp from failing during metadata retrieval when format validation hits edge cases.

---

### Bug Fixes

- **Fixed: "Requested format is not available" on YouTube in production builds.**
  See above - this was caused by missing Deno, not cookies or format strings.

- **Fixed: Potential quarantine issues with bundled ffmpeg on macOS.**

---

### Platform Support

- macOS (.dmg)
- Windows (.exe)
- Linux (.AppImage)

---

### Download

- macOS: `ArcDLP-1.3.7.dmg`
- Windows: `ArcDLP-Setup-1.3.7.exe`
- Linux: `ArcDLP-1.3.7.AppImage`
