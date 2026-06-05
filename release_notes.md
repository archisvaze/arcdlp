## ArcDLP v1.4.0

### New Feature

- **Fetch multiple URLs without waiting.**
  Paste a URL and click Fetch - then immediately paste another. The Fetch button
  stays enabled. Each result appears in a side panel as it completes. Click any
  item to review it, pick a quality, and add it to the download queue. Adding a
  video removes it from the panel and auto-loads the next one.

---

### Improvements

- **Conveyor belt workflow.**
  After adding a video to the queue, the next fetched result loads automatically
  into the video card. No need to click through the panel manually unless you
  want to skip around.

- **Smarter auto-switch to Queue tab.**
  The app no longer switches to the Queue tab immediately after adding the first
  download if there are more fetched items waiting for review.

---

### Technical Notes

- Fetches run sequentially (one yt-dlp process at a time) to avoid rate limiting
  from video sites. Playlists and Instagram collections still use the existing
  blocking flow with streaming UI.
- No backend changes. The fetch queue is purely renderer-side state.

---

### Platform Support

- macOS (.dmg)
- Windows (.exe)
- Linux (.AppImage)

---

### Download

- macOS: `ArcDLP-1.4.0.dmg`
- Windows: `ArcDLP-Setup-1.4.0.exe`
- Linux: `ArcDLP-1.4.0.AppImage`
