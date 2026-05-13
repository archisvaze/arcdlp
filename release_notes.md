## ArcDLP v1.3.8

### New

- **Added: M4A audio download option.**
  You can now download audio as M4A in addition to MP3 and OPUS.
  M4A (AAC) offers wide device compatibility and good quality, especially for Apple devices.

---

### Improvements

- **Audio quality set to maximum.**
  Audio extraction now uses `--audio-quality 0` (best) for all formats.

- **OPUS format selection improved.**
  OPUS downloads now prefer actual Opus-encoded streams (`ba[acodec*=opus]`) instead of falling back to a generic best-audio pick.

---

### Bug Fixes

- **Fixed: All audio formats showing the same file size.**
  MP3, OPUS, and M4A each now show an estimated size based on their own matching audio stream, instead of all displaying the best stream's size.

---

### Platform Support

- macOS (.dmg)
- Windows (.exe)
- Linux (.AppImage)

---

### Download

- macOS: `ArcDLP-1.3.8.dmg`
- Windows: `ArcDLP-Setup-1.3.8.exe`
- Linux: `ArcDLP-1.3.8.AppImage`
