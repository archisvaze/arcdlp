## ArcDLP v1.3.4

### ⚠️ If you are getting errors on YouTube

Before anything else, go to:

**Settings → Reset app (clear cache)**

Then restart and try again.

This fixes most issues caused by stale cookies or corrupted session data.

---

### Improvements

- **Added: Reset app (clear cache) option in Settings.**  
  You can now fully clear app data including cookies, session storage, and cache, then automatically restart the app. This helps resolve issues where YouTube behaves inconsistently after login.

---

### Bug Fixes

- **Fixed: "Requested format is not available" on some sites.**  
  Format selectors were previously too strict and failed on sites that don’t expose separate video/audio streams. Updated to use `bv*+ba/b` with proper fallbacks.

- **Fixed: Playlist format dropdown had the same issue.**

- **Fixed: External yt-dlp config could interfere with downloads.**  
  Now using `--ignore-config` to ensure consistent behavior.

- **Fixed: Audio preset claimed "256 Kb/s".**  
  Removed misleading label.

---

### Platform Support

- macOS (.dmg)
- Windows (.exe)
- Linux (.AppImage)

---

### Download

- macOS: `ArcDLP-1.3.4.dmg`
- Windows: `ArcDLP-Setup-1.3.4.exe`
- Linux: `ArcDLP-1.3.4.AppImage`
