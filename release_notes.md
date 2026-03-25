## ArcDLP v1.3.2

### What's New

- **Instagram saved collections.** Paste a saved collection URL, sign in via Settings, and the app finds all posts in the collection. Select what you want, pick a format, and queue them for download.

- **Instagram sign-in.** New "Instagram Account" section in Settings. Sign in to access your private saved collections. Credentials go directly to Instagram.

- **Smart cookie routing.** Instagram URLs now automatically use your Instagram session for downloads, including individual posts and reels.

- **Toast notifications.** Quick feedback when adding items to queue and when downloads complete. Appears top center, auto-dismisses.

- **Playlist thumbnails.** Playlist items now show video thumbnails.

### Bug Fixes

- **Fixed: Linux AppImage "cannot execute binary file".** The yt-dlp binary bundled in the Linux build was for the wrong architecture when built from an ARM machine. The postinstall script now respects `npm_config_platform` and `npm_config_arch` environment variables, matching how ffmpeg-static handles cross-platform builds.

### Platform Support

- **macOS** (.dmg)
- **Windows** (.exe)
- **Linux** (.AppImage)

### Download

Scroll down to **Assets** and grab the file for your system:

- **macOS**: `ArcDLP-1.3.2.dmg`
- **Windows**: `ArcDLP-Setup-1.3.2.exe`
- **Linux**: `ArcDLP-1.3.2.AppImage`

### Installing on macOS

ArcDLP is not code-signed yet, so macOS will show a warning the first time you open it.

1. Download the `.dmg` and drag ArcDLP to Applications
2. After opening ArcDLP you might see a warning
3. Go to **System Settings → Privacy & Security**
4. Click **Open Anyway** next to ArcDLP

You only need to do this once.

### Installing on Windows

ArcDLP is not code-signed yet, so Windows SmartScreen will show a warning.

1. Run the `.exe` installer
2. Click **More info → Run anyway**

Installs per-user, no admin required.

### Installing on Linux

Download the `.AppImage`, make it executable, run it.
