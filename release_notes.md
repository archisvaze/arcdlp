## What's New in v1.5.2

### ⚡ Improvements

- **Smaller app**: ffmpeg was accidentally bundled twice. It's now included once, so the installed app is about 45 MB smaller on Mac and about 80 MB smaller on Windows
- **Better audio on MP4s with chapters**: embedding or splitting chapters no longer re-encodes the audio a second time, so it's faster and keeps full quality
- **Update banner**: it now sits at the bottom of the window with a clear Download update button, instead of covering the tabs
- **Clearer messages**: if a built-in tool is missing, the app now tells you to reinstall ArcDLP instead of showing developer instructions
- **About tab**: now lists every format ArcDLP saves (MP4, WebM, MP3, M4A, Opus) and explains exactly what the app connects to, with a link to the privacy policy

### 🐛 Fixes

- macOS: if you close the window while downloads are running and reopen it from the Dock, the Queue tab now shows your downloads again instead of looking empty

### 🛠 Behind the scenes

- The Mac app is now built by GitHub Actions, like Windows and Linux. Every build is checked automatically before it's uploaded (signature, plus yt-dlp, Deno and ffmpeg all start), so a broken Mac download like the first 1.5.1 upload can't slip through again
- A build now stops if yt-dlp, Deno or ffmpeg is missing, instead of shipping an app that can't download

### Platform Support

- macOS 13 Ventura or later, Apple Silicon (.dmg). On macOS 12, stay on v1.4.3
- Windows 10 or later (.exe)
- Linux x64 (.AppImage)

---

### Download

- macOS: `ArcDLP-1.5.2-arm64.dmg`
- Windows: `ArcDLP-Setup-1.5.2.exe`
- Linux: `ArcDLP-1.5.2.AppImage`

[Code signing policy](https://arcdlp.archisvaze.com/#code-signing)
