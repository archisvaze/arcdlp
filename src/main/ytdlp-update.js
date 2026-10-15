// yt-dlp Updater
// Downloads the latest yt-dlp into userData/bin, checked against the SHA-256 sums yt-dlp publishes.

const { app, net } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { log } = require('./utils');

const RELEASES_URL = 'https://github.com/yt-dlp/yt-dlp/releases';
const LATEST_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

function assetName() {
    if (process.platform === 'win32') return 'yt-dlp.exe';
    if (process.platform === 'darwin') return 'yt-dlp_macos';
    if (process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
    return 'yt-dlp_linux';
}

function binDir() {
    return path.join(app.getPath('userData'), 'bin');
}

function binPath() {
    return path.join(binDir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

function metaPath() {
    return path.join(binDir(), 'yt-dlp.json');
}

// Only used with the ArcDLP version that installed it, so a newer bundled yt-dlp wins after an app update
function getInstalledPath() {
    try {
        const meta = JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
        if (meta.appVersion === app.getVersion() && fs.existsSync(binPath())) return binPath();
    } catch {
        //
    }
    return null;
}

async function fetchBuffer(url) {
    const res = await net.fetch(url, { headers: { 'User-Agent': 'ArcDLP' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
    return Buffer.from(await res.arrayBuffer());
}

async function updateYtdlp(currentVersion) {
    const release = JSON.parse((await fetchBuffer(LATEST_API)).toString('utf8'));
    const tag = release.tag_name;
    if (!tag) throw new Error('Could not read the latest yt-dlp version');
    if (tag === currentVersion) return { updated: false, version: tag };

    const name = assetName();
    const sums = (await fetchBuffer(`${RELEASES_URL}/download/${tag}/SHA2-256SUMS`)).toString('utf8');
    const entry = sums
        .split('\n')
        .map((l) => l.trim().split(/\s+/))
        .find(([, file]) => file && file.replace(/^\*/, '') === name);
    if (!entry) throw new Error(`No checksum published for ${name}`);

    const bin = await fetchBuffer(`${RELEASES_URL}/download/${tag}/${name}`);
    const hash = crypto.createHash('sha256').update(bin).digest('hex');
    if (hash !== entry[0].toLowerCase()) throw new Error('Checksum mismatch, update cancelled');

    fs.mkdirSync(binDir(), { recursive: true });
    const tmp = binPath() + '.download';
    try {
        fs.writeFileSync(tmp, bin, { mode: 0o755 });
        fs.renameSync(tmp, binPath());
    } catch (err) {
        try {
            fs.unlinkSync(tmp);
        } catch {
            //
        }
        throw new Error(`Could not install yt-dlp: ${err.message}`);
    }
    fs.writeFileSync(metaPath(), JSON.stringify({ version: tag, appVersion: app.getVersion() }));

    log('yt-dlp updated to', tag);
    return { updated: true, version: tag };
}

module.exports = { getInstalledPath, updateYtdlp };
