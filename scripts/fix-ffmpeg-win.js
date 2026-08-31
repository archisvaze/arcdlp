const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
                    spawnSync('xattr', ['-cr', bin], { stdio: 'inherit' });
                    spawnSync('chmod', ['+x', bin], { stdio: 'inherit' });
                    console.log(`Fixed permissions: ${path.basename(bin)}`);
                } catch (err) {
                    console.warn(`Warning: could not fix ${path.basename(bin)}: ${err.message}`);
                }
            }
        }
    }
};
