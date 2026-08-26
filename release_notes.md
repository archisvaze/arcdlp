## What's New in v1.4.3

### 🎬 Choose your video codec

Downloads no longer have to take whatever codec the site ranks highest. A new
**Settings > Video** option lets you pick one:

- **Auto** (default) - Unchanged behaviour, whatever yt-dlp ranks best
- **H.264** - The most compatible option. Opens in QuickTime, Windows Media
  Player, Premiere, and Resolve without converting first
- **VP9** - Smaller files at the same quality, saved as WebM
- **AV1** - The smallest files, for modern players and editors

It is a preference, not a hard filter. If a video doesn't offer the codec you
picked, the download still runs using the best available format. Check this in logs.

### Other changes

- Added a paste button for mouse/trackpad users
- Size estimates on the quality presets now account for the selected codec, so
  AV1 and VP9 no longer show H.264-sized numbers
- VP9 downloads are saved as WebM with Opus audio rather than being forced into
  an MP4 container, which some players will not play.
- Package and dependency updates

### Platform Support

- macOS (M1-M6) (.dmg)
- Windows (.exe)
- Linux (.AppImage)

---

### Download

- macOS: `ArcDLP-1.4.3-arm64.dmg`
- Windows: `ArcDLP-Setup-1.4.3.exe`
- Linux: `ArcDLP-1.4.3.AppImage`
