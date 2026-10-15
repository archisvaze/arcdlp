#!/usr/bin/env node

// Download yt-dlp + Deno binaries
//
// Runs automatically after `npm install`.
// Downloads the correct binaries for the current platform/arch into bin/.

// Set YTDLP_VERSION or DENO_VERSION to a release tag to pin a version, otherwise the latest is used.
// Every download is checked against the SHA-256 sums the project publishes.

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const BIN_DIR = path.join(__dirname, '..', 'bin');

const YTDLP_LATEST_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

function getYtdlpBinaryName() {
    const platform = process.env.npm_config_platform || process.platform;
    const arch = process.env.npm_config_arch || process.arch;

    if (platform === 'win32') return 'yt-dlp.exe';
    if (platform === 'darwin') return 'yt-dlp_macos';
    if (platform === 'linux' && arch === 'arm64') return 'yt-dlp_linux_aarch64';
    if (platform === 'linux') return 'yt-dlp_linux';
    return 'yt-dlp';
}

function getYtdlpOutputName() {
    return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

const DENO_LATEST_URL = 'https://api.github.com/repos/denoland/deno/releases/latest';

function getDenoBinaryInfo() {
    const platform = process.env.npm_config_platform || process.platform;
    const arch = process.env.npm_config_arch || process.arch;

    if (platform === 'darwin' && arch === 'arm64') return { zip: 'deno-aarch64-apple-darwin.zip', exe: 'deno' };
    if (platform === 'darwin') return { zip: 'deno-x86_64-apple-darwin.zip', exe: 'deno' };
    if (platform === 'win32') return { zip: 'deno-x86_64-pc-windows-msvc.zip', exe: 'deno.exe' };
    if (platform === 'linux' && arch === 'arm64') return { zip: 'deno-aarch64-unknown-linux-gnu.zip', exe: 'deno' };
    if (platform === 'linux') return { zip: 'deno-x86_64-unknown-linux-gnu.zip', exe: 'deno' };

    return null;
}

function get(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const headers = { 'User-Agent': 'ArcDLP' };
        // CI runners share IPs, the token avoids GitHub API rate limits. Never sent to other hosts.
        if (process.env.GITHUB_TOKEN && url.startsWith('https://api.github.com/')) {
            headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
        }
        client
            .get(url, { headers }, (res) => {
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

function downloadFile(url, dest, label) {
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
                    process.stdout.write(`\r  Downloading ${label}... ${pct}%  (${(downloaded / 1e6).toFixed(1)} MB)`);
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

async function fetchText(url) {
    const res = await get(url);
    let body = '';
    for await (const chunk of res) body += chunk;
    return body;
}

async function getLatestTag(apiUrl) {
    const release = JSON.parse(await fetchText(apiUrl));
    return release.tag_name;
}

function verifyChecksum(file, expected, label) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== expected.toLowerCase()) {
        fs.unlinkSync(file);
        throw new Error(`${label} checksum mismatch, file removed`);
    }
    console.log(`  ✓ ${label} checksum verified`);
}

// Fail the install on CI so a release is never built without yt-dlp or Deno
function markFailure() {
    if (process.env.CI) process.exitCode = 1;
}

async function downloadYtdlp() {
    const outputName = getYtdlpOutputName();
    const outputPath = path.join(BIN_DIR, outputName);

    if (fs.existsSync(outputPath)) {
        console.log(`  ✓ yt-dlp already exists at bin/${outputName}`);
        return;
    }

    console.log('  🎬 Downloading yt-dlp...');
    const binaryName = getYtdlpBinaryName();

    try {
        const tag = process.env.YTDLP_VERSION || (await getLatestTag(YTDLP_LATEST_URL));
        const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/${binaryName}`;
        console.log(`  Version: ${tag}`);
        console.log(`  Binary: ${binaryName}`);

        await downloadFile(downloadUrl, outputPath, 'yt-dlp');

        const sums = await fetchText(`https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/SHA2-256SUMS`);
        const entry = sums
            .split('\n')
            .map((l) => l.trim().split(/\s+/))
            .find(([, file]) => file && file.replace(/^\*/, '') === binaryName);
        if (!entry) {
            fs.unlinkSync(outputPath);
            throw new Error(`no checksum published for ${binaryName}`);
        }
        verifyChecksum(outputPath, entry[0], 'yt-dlp');

        if (process.platform !== 'win32') {
            fs.chmodSync(outputPath, 0o755);
        }

        console.log(`  ✓ yt-dlp installed to bin/${outputName}`);
    } catch (err) {
        console.error(`  ✗ Failed to download yt-dlp: ${err.message}`);
        console.error('    You can manually download it from: https://github.com/yt-dlp/yt-dlp/releases');
        markFailure();
    }
}

async function downloadDeno() {
    const info = getDenoBinaryInfo();
    if (!info) {
        console.log('  ⚠ Unsupported platform for Deno, skipping');
        return;
    }

    const outputPath = path.join(BIN_DIR, info.exe);

    if (fs.existsSync(outputPath)) {
        console.log(`  ✓ Deno already exists at bin/${info.exe}`);
        return;
    }

    console.log('  Downloading Deno...');

    try {
        const tag = process.env.DENO_VERSION || (await getLatestTag(DENO_LATEST_URL));
        const downloadUrl = `https://github.com/denoland/deno/releases/download/${tag}/${info.zip}`;
        console.log(`  Version: ${tag}`);
        console.log(`  Binary: ${info.zip}`);

        const zipPath = path.join(BIN_DIR, info.zip);
        await downloadFile(downloadUrl, zipPath, 'deno');

        // Deno publishes <zip>.sha256sum, sha256sum format on Unix and a Get-FileHash table on Windows
        const sumText = await fetchText(`${downloadUrl}.sha256sum`).catch(() => null);
        const expected = sumText && (sumText.match(/\b[a-f0-9]{64}\b/i) || [])[0];
        if (expected) {
            verifyChecksum(zipPath, expected, 'Deno');
        } else {
            console.warn('  ⚠ No Deno checksum found, skipping verification');
        }

        console.log('  Extracting...');
        if (process.platform === 'win32') {
            execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}' -Force"`, {
                stdio: 'ignore',
            });
        } else {
            execSync(`unzip -o "${zipPath}" -d "${BIN_DIR}"`, { stdio: 'ignore' });
        }

        fs.unlinkSync(zipPath);

        // Ensure executable
        if (process.platform !== 'win32') {
            fs.chmodSync(outputPath, 0o755);
        }

        console.log(`  ✓ Deno installed to bin/${info.exe}`);
    } catch (err) {
        console.error(`  ✗ Failed to download Deno: ${err.message}`);
        console.error('    You can manually download it from: https://github.com/denoland/deno/releases');
        console.error('    Place the binary in the bin/ folder.');
        markFailure();
    }
}

async function main() {
    if (!fs.existsSync(BIN_DIR)) {
        fs.mkdirSync(BIN_DIR, { recursive: true });
    }

    await downloadYtdlp();
    await downloadDeno();
}

main();
