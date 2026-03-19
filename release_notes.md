## ArcDLP v1.2.2

### What's New

- **Update notifications.** The app now checks for new releases on startup via the GitHub Releases API. When a newer version is available, a banner appears at the top of the window with a link to download it. You can also check manually from the About tab.

### Platform Support

- **macOS** (.dmg)
- **Windows** (.exe)
- **Linux** (.AppImage)

### Download

Scroll down to the **Assets** section below and click the file for your system:

- **macOS**: `ArcDLP-1.2.2.dmg`
- **Windows**: `ArcDLP-Setup-1.2.2.exe` - Playlists Needs testing
- **Linux**: `ArcDLP-1.2.2.AppImage` - Needs Testing

### Installing on macOS

ArcDLP is not code-signed yet, so macOS will show a warning the first time you open it. This is normal.

1. Download the `.dmg` file
2. Drag ArcDLP to your Applications folder
3. Open ArcDLP

You will see a warning saying the app cannot be verified. To fix this:

1. Click **Done**
2. Open **System Settings**
3. Go to **Privacy & Security**
4. Scroll down
5. Click **Open Anyway** next to ArcDLP
6. Enter your password

You only need to do this once.

### Installing on Windows

ArcDLP is not code-signed yet, so Windows will show a SmartScreen warning the first time you run the installer. This is normal for new unsigned apps.

1. Download and run the `.exe` installer
2. Windows will show **"Windows protected your PC"**
3. Click **More info**
4. Click **Run anyway**
5. The installer will set up ArcDLP and create a shortcut

You only need to do this once. ArcDLP installs per-user (no admin required) and can be uninstalled from Settings > Apps.

### Installing on Linux

No installation required. The AppImage runs directly.

1. Download the `.AppImage` file
2. Make it executable:
    - Right-click the file → Properties → Permissions → check **Allow executing file as program**
    - Or run: `chmod +x ArcDLP-1.2.2.AppImage`
3. Double-click to run

You can move the AppImage anywhere you like (e.g. `~/Applications/`).
