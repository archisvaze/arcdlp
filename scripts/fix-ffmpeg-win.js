const fs = require('fs');
const path = require('path');

exports.default = async function (context) {
    if (context.electronPlatformName !== 'win32') return;

    const src = path.join(context.appOutDir, 'resources', 'ffmpeg-static', 'ffmpeg');
    const dest = path.join(context.appOutDir, 'resources', 'ffmpeg-static', 'ffmpeg.exe');

    if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.renameSync(src, dest);
        console.log('Renamed ffmpeg -> ffmpeg.exe for Windows');
    }
};
