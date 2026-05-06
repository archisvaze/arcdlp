## ArcDLP v1.3.5

### ⚠️ If you are getting errors on YouTube

Before anything else, go to:

**Settings → Reset app (clear cache)**

Then restart and try again.

This fixes most issues caused by stale cookies or corrupted session data.

---

### New

- **Added: OPUS audio download option.**  
  You can now download audio directly as OPUS in addition to MP3.  
  OPUS provides better quality at smaller file sizes and avoids unnecessary re-encoding in many cases.

- **Improved: Audio format handling.**  
  Audio extraction is no longer hardcoded to MP3. The selected format now flows correctly through the entire pipeline (UI → queue → yt-dlp).

---

### Improvements (from v1.3.4)

- **Added: Reset app (clear cache) option in Settings.**  
  Fully clears cookies, session storage, and cache, then restarts the app. Useful when YouTube login or downloads behave inconsistently.

---

### Bug Fixes (from v1.3.4)

- **Fixed: "Requested format is not available" on some sites.**  
  Updated format selection to use `bv*+ba/b` with proper fallbacks for broader compatibility.

- **Fixed: Playlist format dropdown inconsistency.**

- **Fixed: External yt-dlp config interference.**  
  Now using `--ignore-config` to ensure consistent behavior across systems.

- **Fixed: Misleading "256 Kb/s" audio label.**

---

### Platform Support

- macOS (.dmg)
- Windows (.exe)
- Linux (.AppImage)

---

### Download

- macOS: `ArcDLP-1.3.5.dmg`
- Windows: `ArcDLP-Setup-1.3.5.exe`
- Linux: `ArcDLP-1.3.5.AppImage`
