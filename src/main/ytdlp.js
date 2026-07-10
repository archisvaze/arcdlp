// yt-dlp Engine
// Handles: binary resolution, video info fetching, downloading with structured progress output.

const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { log, logError } = require('./utils');
const cookies = require('./cookies');

// Append --cookies flag if user is signed in.
// Use Instagram cookies for Instagram URLs, YouTube cookies otherwise.
async function appendCookieArgs(args, url) {
    try {
        if (url && url.includes('instagram.com')) {
            const cookieFile = await cookies.getInstaCookieFile();
            if (cookieFile) {
                args.push('--cookies', cookieFile);
                log('Using Instagram cookie file:', cookieFile);
            }
        } else {
            const cookieFile = await cookies.getCookieFile();
            if (cookieFile) {
                args.push('--cookies', cookieFile);
                log('Using cookie file:', cookieFile);
            }
        }
    } catch (err) {
        logError('Cookie file error:', err.message);
    }
}

function getFfmpegPath() {
    const ext = process.platform === 'win32' ? '.exe' : '';

    try {
        const resBase = process.resourcesPath || '';
        const candidates = [path.join(resBase, 'ffmpeg-static', 'ffmpeg' + ext), path.join(resBase, 'ffmpeg-static', 'ffmpeg')];
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                log('Using extraResources ffmpeg:', p);
                return p;
            }
        }
    } catch {
        //
    }

    try {
        const ffmpegStatic = require('ffmpeg-static');
        if (ffmpegStatic) {
            const unpackedPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
            if (fs.existsSync(unpackedPath)) {
                log('Using unpacked ffmpeg-static:', unpackedPath);
                return unpackedPath;
            }
            if (fs.existsSync(ffmpegStatic)) {
                log('Using ffmpeg-static:', ffmpegStatic);
                return ffmpegStatic;
            }
        }
    } catch {
        //
    }

    log('Falling back to system ffmpeg');
    return 'ffmpeg';
}

function getYtdlpPath() {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binary = 'yt-dlp' + ext;

    try {
        const resPath = path.join(process.resourcesPath || '', 'bin', binary);
        if (fs.existsSync(resPath)) {
            log('Using extraResources yt-dlp:', resPath);
            return resPath;
        }
    } catch {
        //
    }

    const devPath = path.join(__dirname, '..', '..', 'bin', binary);
    if (fs.existsSync(devPath)) {
        log('Using dev yt-dlp:', devPath);
        return devPath;
    }

    logError('yt-dlp binary not found!');
    return null;
}

function getDenoPath() {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const binary = 'deno' + ext;

    // Check extraResources (production)
    try {
        const resPath = path.join(process.resourcesPath || '', 'bin', binary);
        if (fs.existsSync(resPath)) {
            log('Using extraResources deno:', resPath);
            return resPath;
        }
    } catch {
        //
    }

    // Check local bin/ (dev)
    const devPath = path.join(__dirname, '..', '..', 'bin', binary);
    if (fs.existsSync(devPath)) {
        log('Using dev deno:', devPath);
        return devPath;
    }

    log('Bundled deno not found, hoping system PATH has it');
    return null;
}

// Build env with bundled Deno on PATH so yt-dlp can find it
function getSpawnEnv() {
    const env = { ...process.env };
    const deno = getDenoPath();
    if (deno) {
        const denoDir = path.dirname(deno);
        env.PATH = denoDir + path.delimiter + (env.PATH || '');
        log('Injected deno dir into PATH:', denoDir);
    }
    return env;
}

function checkDeps() {
    const ytdlp = getYtdlpPath();
    const ffmpeg = getFfmpegPath();
    const deno = getDenoPath();

    const result = {
        ytdlp: { found: !!ytdlp, path: ytdlp },
        ffmpeg: { found: !!ffmpeg && ffmpeg !== 'ffmpeg', path: ffmpeg },
        deno: { found: !!deno, path: deno },
    };

    log('Dependencies:', JSON.stringify(result, null, 2));
    return result;
}

function execVersion(binPath, args) {
    return new Promise((resolve) => {
        const proc = execFile(binPath, args, { encoding: 'utf8', timeout: 1000000 }, (err, stdout) => {
            if (err) return resolve(null);
            resolve(stdout);
        });
    });
}

async function getVersions() {
    const versions = { ytdlp: null, ffmpeg: null, deno: null };

    const ytdlpPath = getYtdlpPath();
    if (ytdlpPath) {
        try {
            const out = await execVersion(ytdlpPath, ['--version']);
            if (out) versions.ytdlp = out.trim();
        } catch (err) {
            logError('yt-dlp version check failed:', err.message);
        }
    }

    const ffmpegPath = getFfmpegPath();
    if (ffmpegPath && ffmpegPath !== 'ffmpeg') {
        try {
            const out = await execVersion(ffmpegPath, ['-version']);
            if (out) {
                const match = out.match(/ffmpeg version (\S+)/);
                versions.ffmpeg = match ? match[1] : out.split('\n')[0].trim();
            }
        } catch (err) {
            logError('ffmpeg version check failed:', err.message);
        }
    }

    const denoPath = getDenoPath();
    if (denoPath) {
        try {
            const out = await execVersion(denoPath, ['--version']);
            if (out) {
                versions.deno = out
                    .split('\n')[0]
                    .replace(/^deno\s+/, '')
                    .trim();
            }
        } catch (err) {
            logError('deno version check failed:', err.message);
        }
    }

    log('Versions:', JSON.stringify(versions));
    return versions;
}

async function fetchInfo(url, { onLog } = {}) {
    const ytdlp = getYtdlpPath();
    if (!ytdlp) {
        throw new Error('yt-dlp not found. Run npm install to download it.');
    }

    const _log = (msg) => {
        log(msg);
        if (onLog) onLog(msg);
    };

    _log('Launching yt-dlp...');
    log('Fetching info:', url);

    const args = ['--dump-json', '--no-playlist', '--no-warnings', '--ignore-config', '--no-check-formats', '--socket-timeout', '30'];
    const ffmpeg = getFfmpegPath();
    if (ffmpeg && ffmpeg !== 'ffmpeg') {
        args.push('--ffmpeg-location', path.dirname(ffmpeg));
    }
    await appendCookieArgs(args, url);
    args.push(url);

    return new Promise((resolve, reject) => {
        const proc = spawn(ytdlp, args, { env: getSpawnEnv() });
        let stdout = '';
        let stderr = '';
        let killed = false;

        // Process timeout - spawn() doesn't support timeout option
        const timer = setTimeout(() => {
            killed = true;
            try {
                proc.kill('SIGTERM');
            } catch {
                /* */
            }
            reject(new Error('Fetch timed out after 60 seconds'));
        }, 60000);

        proc.stdout.on('data', (d) => {
            stdout += d.toString();
            _log('Receiving video data...');
        });

        proc.stderr.on('data', (d) => {
            const text = d.toString();
            stderr += text;
            const lines = text.split('\n');
            for (const line of lines) {
                const t = line.trim();
                if (t && t.length < 200) {
                    _log(t);
                }
            }
        });

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (killed) return; // already rejected by timeout

            if (code !== 0) {
                const msg = stderr.trim() || `yt-dlp exited with code ${code}`;
                logError('Fetch failed:', msg);
                _log(`[diag] exit code: ${code}`);
                _log(`[diag] stderr: ${stderr.trim().slice(0, 500)}`);
                return reject(new Error(msg));
            }

            try {
                const raw = JSON.parse(stdout);
                const info = cleanInfo(raw);
                _log(`Found: ${info.title}`);
                log('Fetched:', info.title, `(${info.formats.length} formats)`);
                resolve({ info, raw });
            } catch (e) {
                logError('Parse failed:', e.message);
                reject(new Error('Failed to parse video info'));
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            if (killed) return;
            logError('Spawn error:', err.message);
            reject(new Error(`Cannot run yt-dlp: ${err.message}`));
        });
    });
}

function cleanInfo(raw) {
    const formats = (raw.formats || []).map((f) => ({
        format_id: f.format_id,
        ext: f.ext,
        height: f.height || null,
        fps: f.fps || null,
        vcodec: f.vcodec || 'none',
        acodec: f.acodec || 'none',
        filesize: f.filesize || f.filesize_approx || null,
        tbr: f.tbr || null,
        format_note: f.format_note || '',
    }));

    return {
        id: raw.id,
        title: raw.title || raw.id,
        thumbnail: raw.thumbnail || null,
        duration: raw.duration || null,
        duration_string: raw.duration_string || null,
        uploader: raw.uploader || raw.channel || '',
        uploader_id: raw.uploader_id || raw.channel_id || '',
        channel: raw.channel || '',
        channel_url: raw.channel_url || '',
        view_count: raw.view_count || null,
        like_count: raw.like_count || null,
        upload_date: raw.upload_date || null,
        description: raw.description || null,
        categories: raw.categories || [],
        tags: raw.tags || [],
        extractor: raw.extractor || '',
        extractor_key: raw.extractor_key || '',
        webpage_url: raw.webpage_url || '',
        webpage_url_domain: raw.webpage_url_domain || '',
        age_limit: raw.age_limit || 0,
        live_status: raw.live_status || 'not_live',
        formats,
        _fetched_at: Date.now(),
    };
}

function buildPresets(formats) {
    // Collect every unique height yt-dlp reports
    // Any format with a height is video, regardless of codec reporting.
    // Some sites report vcodec/acodec as 'none' for muxed streams.
    const heightSet = new Set();
    for (const f of formats) {
        if (f.height) heightSet.add(f.height);
    }

    // Sort descending so highest quality appears first
    const heights = [...heightSet].sort((a, b) => b - a);

    // Friendly tags for well-known resolutions
    const tags = { 2160: '4K', 1440: '2K', 1080: 'Full HD', 720: 'HD' };

    function estimateSize(h) {
        const matching = formats.filter((f) => f.height === h && f.filesize);
        if (matching.length === 0) return null;
        return Math.max(...matching.map((f) => f.filesize));
    }

    function formatBytes(bytes) {
        if (!bytes) return null;
        if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
        if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
        return (bytes / 1e3).toFixed(0) + ' KB';
    }

    const presets = [];

    // Only shown when video formats exist
    if (heights.length > 0) {
        presets.push({
            id: 'best',
            label: 'Best',
            tag: '',
            size: null,
            formatId: 'bv*+ba/b',
            type: 'video',
        });
    }

    // One preset per unique height yt-dlp found
    for (const h of heights) {
        presets.push({
            id: `${h}p`,
            label: `${h}p`,
            tag: tags[h] || '',
            size: formatBytes(estimateSize(h)),
            formatId: `bv*[height<=${h}]+ba/b[height<=${h}]/b`,
            type: 'video',
        });
    }

    // Audio extraction and estimate size per format
    const audioStreams = formats
        .filter((f) => f.vcodec === 'none' && f.acodec !== 'none' && f.filesize)
        .sort((a, b) => (b.tbr || 0) - (a.tbr || 0));

    const audioSize = (filterFn) => {
        const match = audioStreams.find(filterFn);
        return (match || audioStreams[0])?.filesize || null;
    };

    presets.push({
        id: 'audio-mp3',
        label: 'MP3',
        tag: '',
        size: formatBytes(audioSize(() => true)),
        formatId: 'ba/b',
        type: 'audio',
        audioFormat: 'mp3',
    });

    presets.push({
        id: 'audio-opus',
        label: 'OPUS',
        tag: '',
        size: formatBytes(audioSize((f) => f.acodec?.includes('opus'))),
        formatId: 'ba[acodec*=opus]/ba/b',
        type: 'audio',
        audioFormat: 'opus',
    });

    presets.push({
        id: 'audio-m4a',
        label: 'M4A',
        tag: '',
        size: formatBytes(audioSize((f) => f.ext === 'm4a')),
        formatId: 'ba[ext=m4a]/ba/b',
        type: 'audio',
        audioFormat: 'm4a',
    });

    return presets;
}

async function download({ url, formatId, outputDir, extractAudio, audioFormat }, callbacks) {
    const { onProgress, onLog } = callbacks;

    const ytdlp = getYtdlpPath();
    if (!ytdlp) throw new Error('yt-dlp not found');

    log('Starting download:', url);
    onLog('Starting download...');

    const args = [
        '--newline',
        '--no-warnings',
        '--ignore-config',
        '--socket-timeout',
        '30',
        '--progress-template',
        'download:DLPROG %(progress._percent_str)s %(progress._speed_str)s %(progress._eta_str)s',
        '-o',
        path.join(outputDir, '%(title)s [%(id)s].%(ext)s'),
    ];

    const ffmpeg = getFfmpegPath();
    if (ffmpeg && ffmpeg !== 'ffmpeg') {
        args.push('--ffmpeg-location', path.dirname(ffmpeg));
    }

    if (extractAudio) {
        args.push('-x', '--audio-format', audioFormat || 'mp3', '--audio-quality', '0');
    } else if (formatId) {
        args.push('-f', formatId, '--merge-output-format', 'mp4');
        // Re-encode audio to AAC for universal playback.
        // YouTube serves Opus audio which Windows Media Player can't decode in MP4.
        // AAC is fast to encode and works on every player on every OS.
        args.push('--postprocessor-args', 'ffmpeg:-c:v copy -c:a aac');
    }

    await appendCookieArgs(args, url);
    args.push(url);
    log('Download args:', args.join(' '));

    return new Promise((resolve, reject) => {
        const proc = spawn(ytdlp, args, { env: getSpawnEnv() });

        // Parse progress from both stdout and stderr
        function parseOutput(data) {
            const text = data.toString();
            const lines = text.split('\n');
            for (const line of lines) {
                if (line.startsWith('DLPROG ')) {
                    const parts = line.slice(7).trim().split(/\s+/);
                    const percent = (parts[0] || '0%').trim();
                    const speed = (parts[1] || '').trim();
                    const eta = (parts[2] || '').trim();
                    log('Progress:', percent, speed, eta);
                    onProgress({ percent, speed, eta });
                    continue;
                }

                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('WARNING')) {
                    if (
                        trimmed.startsWith('[download]') ||
                        trimmed.startsWith('[Merger]') ||
                        trimmed.startsWith('[ExtractAudio]') ||
                        trimmed.startsWith('[info]') ||
                        trimmed.startsWith('Deleting')
                    ) {
                        onLog(trimmed);
                    }
                }
            }
        }

        proc.stdout.on('data', parseOutput);

        let stderrBuf = '';
        proc.stderr.on('data', (d) => {
            stderrBuf += d.toString();
            parseOutput(d);
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                const msg = stderrBuf.trim() || `yt-dlp exited with code ${code}`;
                logError('Download failed:', msg);
                onLog('Download failed.');
                return reject(new Error(msg));
            }
            log('Download completed');
            onLog('Download complete ✓');
            resolve({ ok: true });
        });

        proc.on('error', (err) => {
            logError('Download spawn error:', err.message);
            reject(new Error(`Cannot run yt-dlp: ${err.message}`));
        });

        callbacks._proc = proc;
    });
}

async function fetchPlaylist(url, { onLog, onItem } = {}) {
    const ytdlp = getYtdlpPath();
    if (!ytdlp) {
        throw new Error('yt-dlp not found. Run npm install to download it.');
    }

    const _log = (msg) => {
        log(msg);
        if (onLog) onLog(msg);
    };

    _log('Fetching playlist info...');
    log('Fetching playlist:', url);

    const args = ['--flat-playlist', '--dump-json', '--no-warnings', '--ignore-config', '--socket-timeout', '30'];
    const ffmpeg = getFfmpegPath();
    if (ffmpeg && ffmpeg !== 'ffmpeg') {
        args.push('--ffmpeg-location', path.dirname(ffmpeg));
    }
    await appendCookieArgs(args, url);
    args.push(url);

    return new Promise((resolve, reject) => {
        const proc = spawn(ytdlp, args, { env: getSpawnEnv() });
        let stderr = '';
        const items = [];
        let buffer = '';
        let killed = false;

        // Process timeout - 15 minutes for large playlists
        const timer = setTimeout(() => {
            killed = true;
            try {
                proc.kill('SIGTERM');
            } catch {
                /* */
            }
            // Partial success - return whatever we got
            if (items.length > 0) {
                _log(`Playlist timed out after fetching ${items.length} items`);
                resolve({ items });
            } else {
                reject(new Error('Playlist fetch timed out after 15 minutes'));
            }
        }, 900000);

        proc.stdout.on('data', (d) => {
            buffer += d.toString();

            // yt-dlp outputs one JSON object per line
            const lines = buffer.split('\n');
            // Keep last (possibly incomplete) line in buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const raw = JSON.parse(trimmed);
                    const item = {
                        id: raw.id || '',
                        title: raw.title || raw.id || 'Untitled',
                        url: raw.url || raw.webpage_url || '',
                        webpage_url: raw.webpage_url || raw.url || '',
                        duration: raw.duration || null,
                        duration_string: raw.duration_string || null,
                        thumbnail: raw.thumbnails?.[0]?.url || raw.thumbnail || null,
                        uploader: raw.uploader || raw.channel || '',
                        extractor_key: raw.ie_key || raw.extractor_key || '',
                        _playlist_index: items.length + 1,
                    };
                    items.push(item);

                    if (onItem) onItem(item, items.length);
                    _log(`Found: ${items.length}. ${item.title}`);
                } catch {
                    // Not valid JSON line, skip
                }
            }
        });

        proc.stderr.on('data', (d) => {
            const text = d.toString();
            stderr += text;
            const lines = text.split('\n');
            for (const line of lines) {
                const t = line.trim();
                if (t && !t.startsWith('WARNING') && t.length < 200) {
                    _log(t);
                }
            }
        });

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (killed) return; // already resolved/rejected by timeout

            // Process any remaining buffer
            if (buffer.trim()) {
                try {
                    const raw = JSON.parse(buffer.trim());
                    const item = {
                        id: raw.id || '',
                        title: raw.title || raw.id || 'Untitled',
                        url: raw.url || raw.webpage_url || '',
                        webpage_url: raw.webpage_url || raw.url || '',
                        duration: raw.duration || null,
                        duration_string: raw.duration_string || null,
                        thumbnail: raw.thumbnails?.[0]?.url || raw.thumbnail || null,
                        uploader: raw.uploader || raw.channel || '',
                        extractor_key: raw.ie_key || raw.extractor_key || '',
                        _playlist_index: items.length + 1,
                    };
                    items.push(item);
                    if (onItem) onItem(item, items.length);
                } catch {
                    /* */
                }
            }

            if (code !== 0 && items.length === 0) {
                const msg = stderr.trim() || `yt-dlp exited with code ${code}`;
                logError('Playlist fetch failed:', msg);
                return reject(new Error(msg));
            }

            // Even if exit code is non-zero, if we got items, return them (partial success)
            if (items.length > 0) {
                _log(`Found ${items.length} item${items.length !== 1 ? 's' : ''} in playlist`);
                log('Playlist fetched:', items.length, 'items');
            }

            resolve({ items });
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            if (killed) return;
            logError('Playlist spawn error:', err.message);
            reject(new Error(`Cannot run yt-dlp: ${err.message}`));
        });
    });
}

// Detect if a URL looks like a playlist
function looksLikePlaylist(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    // YouTube playlists
    if (u.includes('list=')) return true;
    if (u.includes('/playlist')) return true;
    // YouTube channel/user pages (uploads = implicit playlist)
    if (u.includes('/channel/') || u.includes('/c/') || u.includes('/@')) {
        return true;
    }
    // SoundCloud sets
    if (u.includes('/sets/')) return true;
    // Generic patterns
    if (u.includes('/album/') || u.includes('/albums/')) return true;
    // Instagram saved collections
    if (u.includes('instagram.com') && u.includes('/saved/')) return true;
    return false;
}

module.exports = {
    checkDeps,
    getVersions,
    fetchInfo,
    fetchPlaylist,
    looksLikePlaylist,
    buildPresets,
    download,
};
