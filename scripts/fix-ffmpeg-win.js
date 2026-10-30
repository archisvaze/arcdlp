const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function (context) {
    const platform = context.electronPlatformName;
    const resDir = path.join(context.appOutDir, platform === 'darwin' ? 'ArcDLP.app/Contents/Resources' : 'resources');

    if (platform === 'win32') {
        const src = path.join(resDir, 'ffmpeg-static', 'ffmpeg');
        const dest = path.join(resDir, 'ffmpeg-static', 'ffmpeg.exe');
        if (fs.existsSync(src) && !fs.existsSync(dest)) {
            fs.renameSync(src, dest);
            console.log('Renamed ffmpeg -> ffmpeg.exe for Windows');
        }
    }

    if (platform === 'darwin') {
        const binaries = [
            path.join(resDir, 'bin', 'yt-dlp'),
            path.join(resDir, 'bin', 'deno'),
            path.join(resDir, 'ffmpeg-static', 'ffmpeg'),
        ];

        for (const bin of binaries) {
            if (fs.existsSync(bin)) {
                try {
                    execFileSync('xattr', ['-cr', bin]);
                    execFileSync('chmod', ['+x', bin]);
                    console.log(`Fixed permissions: ${path.basename(bin)}`);
                } catch (err) {
                    console.warn(`Warning: could not fix ${path.basename(bin)}: ${err.message}`);
                }
            }
        }

        // Ad-hoc sign the whole app here. electron-builder 25 can't ad-hoc sign (mac.identity is
        // null in package.json) and skips afterSign when it didn't sign, so afterPack is the last
        // hook that runs before the dmg/zip are made. Without this the app keeps Electron's stub
        // signature and downloaded copies are reported as "damaged" by macOS.
        // Signed inside out: bundled tools first, then the app. Any failure stops the build.
        const appPath = path.join(context.appOutDir, 'ArcDLP.app');
        const helpers = [
            ...binaries,
            path.join(resDir, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg'),
        ].filter((bin) => fs.existsSync(bin));

        execFileSync('xattr', ['-cr', appPath]);
        for (const bin of helpers) {
            execFileSync('codesign', ['--force', '--sign', '-', bin], { stdio: 'inherit' });
        }
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
        execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
        console.log('Ad-hoc signed ArcDLP.app');
    }
};
