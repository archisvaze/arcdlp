## What's New in v1.5.0

### 🔒 Security update

- Electron upgraded from 33 to 44, with current Chromium security fixes
- Dropping a link or file on the window can no longer replace the app with a web page
- Fixed a bug where specially crafted playlist entries could run code inside the app
- YouTube and Instagram sign-in cookies are now kept in the app's private data folder and deleted after each download, instead of a shared temp file

### ✨ New

- **Multi-video posts** - Instagram carousels, Reddit galleries and X posts with several videos now open as a list you can pick from, instead of failing
- **Update yt-dlp from Settings** - When a site breaks, update yt-dlp in one click without waiting for a new ArcDLP release
- **Proxy support** - Settings > Network accepts HTTP, HTTPS and SOCKS proxies
- **Stop button** - Stop a playlist or Instagram collection fetch midway and keep what was found
- **Drag and drop** - Drop a link onto the window to fetch it
- **Song info in audio files** - MP3, M4A and Opus downloads now include title, artist and cover art
- **Merge progress** - The queue shows Merging, Converting audio and similar steps, so long videos no longer look stuck

### 🐛 Fixes

- The VP9 codec setting no longer fails on videos that don't offer VP9. Those are saved as MKV instead
- TikTok video links and YouTube Mix links no longer open as playlists
- Fetch errors now say what went wrong, and the sign-in prompt for age-restricted videos works again
- Cancelling a download removes its partial files
- Reset now fully signs you out on Windows
- Linux: the AppImage no longer needs libfuse2 and supports delta updates through AppImageUpdate, AM and AppImageLauncher

Thanks to @anupamme for #32.

### Platform Support

- macOS 13 Ventura or later, Apple Silicon (.dmg)
- Windows 10 or later (.exe)
- Linux x64 (.AppImage)

---

### Download

- macOS: `ArcDLP-1.5.0-arm64.dmg`
- Windows: `ArcDLP-Setup-1.5.0.exe`
- Linux: `ArcDLP-1.5.0.AppImage`

[Code signing policy](https://arcdlp.archisvaze.com/#code-signing)
