## ArcDLP v1.3.9

### Bug Fixes

- **Fixed: Login windows could not be closed.**
  The YouTube and Instagram sign-in windows no longer lock the app. You can close them at any time without force-quitting.

---

### Improvements

- **Instagram collections: thumbnails and captions.**
  Scraped Instagram collection items now show thumbnail previews and use the post caption as the title instead of generic "Post 1", "Post 2" labels.

- **Instagram collections: photo posts filtered out.**
  Collections with a mix of photos and videos now automatically skip photo posts, since yt-dlp only supports video downloads. If a photo slips through, it fails gracefully without stopping the queue.

- **Dependency versions in Settings.**
  The Settings → Dependencies section now shows the installed version of yt-dlp, ffmpeg, and Deno. Versions are fetched in the background at launch so the Settings tab opens instantly.

- **Deno added to Dependencies.**
  Deno is now listed alongside yt-dlp and ffmpeg in Settings → Dependencies with its own status indicator and version.

- **App icon in About tab.**
  The About tab now shows the ArcDLP icon.

---

### Platform Support

- macOS (.dmg)
- Windows (.exe)
- Linux (.AppImage)

---

### Download

- macOS: `ArcDLP-1.3.9.dmg`
- Windows: `ArcDLP-Setup-1.3.9.exe`
- Linux: `ArcDLP-1.3.9.AppImage`
