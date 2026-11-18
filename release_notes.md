## What's New in v1.5.2

### ⚡ Improvements

- **Smaller app**: ffmpeg was accidentally bundled twice. It's now included once, so the installed app is about 45 MB smaller on Mac and about 80 MB smaller on Windows
- **Better audio on MP4s with chapters**: embedding or splitting chapters no longer re-encodes the audio a second time, so it's faster and keeps full quality
- **Update banner**: it now sits at the bottom of the window with a clear Download update button, instead of covering the tabs
- **Clearer messages**: if a built-in tool is missing, the app now tells you to reinstall ArcDLP instead of showing developer instructions
- **About tab**: now lists every format ArcDLP saves (MP4, WebM, MP3, M4A, Opus) and explains exactly what the app connects to, with a link to the privacy policy
- **Paste with Ctrl+V / Cmd+V**: on the Download tab the shortcut now fills in the link box even if you haven't clicked into it first
- **Cleaner log**: fetching a video no longer repeats the same lines over and over

### 🐛 Fixes

- macOS: if you close the window while downloads are running and reopen it from the Dock, the Queue tab now shows your downloads again instead of looking empty
- Cancel all: a download you added or retried right after pressing Cancel all could start while the cancelled one was still stopping. Now it waits its turn, and the cancelled download is always marked Cancelled with its unfinished files cleaned up
- Open folder now works before your first download. It used to do nothing until the download folder existed

### 🛠 Behind the scenes

- The Mac app is now built by GitHub Actions, like Windows and Linux. Every build is checked automatically before it's uploaded (signature, plus yt-dlp, Deno and ffmpeg all start), so a broken Mac download like the first 1.5.1 upload can't slip through again
- A build now stops if yt-dlp, Deno or ffmpeg is missing, instead of shipping an app that can't download
- Building from source: building for another platform now gets the right yt-dlp, and a dropped connection during `npm install` no longer hangs it or leaves a broken yt-dlp behind

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
