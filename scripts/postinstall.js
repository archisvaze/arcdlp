#!/usr/bin/env node

// Download yt-dlp binary
//
// Runs automatically after `npm install`.
// Downloads the correct yt-dlp binary for the current platform/arch into bin/.

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const LATEST_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

function getBinaryName() {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'win32') return 'yt-dlp.exe';
    if (platform === 'darwin') return 'yt-dlp_macos';
    if (platform === 'linux' && arch === 'arm64') return 'yt-dlp_linux_aarch64';
    if (platform === 'linux') return 'yt-dlp_linux';

    // Fallback: platform-independent (needs Python)
    return 'yt-dlp';
}

function getOutputName() {
    return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

function get(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client
            .get(url, { headers: { 'User-Agent': 'ArcDLP' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return get(res.headers.location).then(resolve, reject);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                resolve(res);
            })
            .on('error', reject);
    });
}

function downloadFile(url, dest) {
    return new Promise(async (resolve, reject) => {
        try {
            const res = await get(url);
            const total = parseInt(res.headers['content-length'], 10) || 0;
            let downloaded = 0;

            const file = fs.createWriteStream(dest);
            res.on('data', (chunk) => {
                downloaded += chunk.length;
                if (total > 0) {
                    const pct = Math.round((downloaded / total) * 100);
                    process.stdout.write(`\r  Downloading yt-dlp... ${pct}%  (${(downloaded / 1e6).toFixed(1)} MB)`);
                }
            });
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                process.stdout.write('\n');
                resolve();
            });
            file.on('error', reject);
        } catch (err) {
            reject(err);
        }
    });
}

async function main() {
    const outputName = getOutputName();
    const outputPath = path.join(BIN_DIR, outputName);

    if (fs.existsSync(outputPath)) {
        console.log(`  ✓ yt-dlp already exists at bin/${outputName}`);
        return;
    }

    console.log('  🎬 Downloading yt-dlp...');

    // Ensure bin/ exists
    if (!fs.existsSync(BIN_DIR)) {
        fs.mkdirSync(BIN_DIR, { recursive: true });
    }

    const binaryName = getBinaryName();

    // Get latest release URL from GitHub
    try {
        const res = await get(LATEST_URL);
        let body = '';
        for await (const chunk of res) body += chunk;
        const release = JSON.parse(body);
        const tag = release.tag_name;

        const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/${binaryName}`;
        console.log(`  Version: ${tag}`);
        console.log(`  Binary: ${binaryName}`);

        await downloadFile(downloadUrl, outputPath);

        // Make executable on Unix
        if (process.platform !== 'win32') {
            fs.chmodSync(outputPath, 0o755);
        }

        console.log(`  ✓ yt-dlp installed to bin/${outputName}`);
    } catch (err) {
        console.error(`  ✗ Failed to download yt-dlp: ${err.message}`);
        console.error('    You can manually download it from: https://github.com/yt-dlp/yt-dlp/releases');
        process.exit(0);
    }
}

main();
