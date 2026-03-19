// yt-dlp Engine
// Handles: binary resolution, video info fetching, downloading with structured progress output.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { log, logError } = require('./utils');
const cookies = require('./cookies');

// Append --cookies flag if user is signed in
async function appendCookieArgs(args) {
    try {
        const cookieFile = await cookies.getCookieFile();
        if (cookieFile) {
            args.push('--cookies', cookieFile);
            log('Using cookie file:', cookieFile);
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

function checkDeps() {
    const ytdlp = getYtdlpPath();
    const ffmpeg = getFfmpegPath();

    const result = {
        ytdlp: { found: !!ytdlp, path: ytdlp },
        ffmpeg: { found: !!ffmpeg && ffmpeg !== 'ffmpeg', path: ffmpeg },
    };

    log('Dependencies:', JSON.stringify(result, null, 2));
    return result;
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

    const args = ['--dump-json', '--no-playlist', '--no-warnings', '--socket-timeout', '30'];
    const ffmpeg = getFfmpegPath();
    if (ffmpeg && ffmpeg !== 'ffmpeg') {
        args.push('--ffmpeg-location', path.dirname(ffmpeg));
    }
    await appendCookieArgs(args);
    args.push(url);

    return new Promise((resolve, reject) => {
        const proc = spawn(ytdlp, args);
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
            // Forward yt-dlp status lines
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
            if (killed) return; // already rejected by timeout

            if (code !== 0) {
                const msg = stderr.trim() || `yt-dlp exited with code ${code}`;
                logError('Fetch failed:', msg);
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

    // "Best" option — yt-dlp pick the optimal format.
    // Only shown when video formats exist
    if (heights.length > 0) {
        presets.push({
            id: 'best',
            label: 'Best',
            tag: '',
            size: null,
            formatId: 'bestvideo+bestaudio/best',
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
            formatId: `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`,
            type: 'video',
        });
    }

    // Audio extraction — always available
    const audioBest = formats
        .filter((f) => f.vcodec === 'none' && f.acodec !== 'none' && f.filesize)
        .sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];

    presets.push({
        id: 'audio',
        label: 'MP3',
        tag: '256 Kb/s',
        size: formatBytes(audioBest?.filesize),
        formatId: 'bestaudio/best',
        type: 'audio',
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
        args.push('-x', '--audio-format', audioFormat || 'mp3');
    } else if (formatId) {
        args.push('-f', formatId, '--merge-output-format', 'mp4');
    }

    await appendCookieArgs(args);
    args.push(url);
    log('Download args:', args.join(' '));

    return new Promise((resolve, reject) => {
        const proc = spawn(ytdlp, args);

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

    const args = ['--flat-playlist', '--dump-json', '--no-warnings', '--socket-timeout', '30'];
    const ffmpeg = getFfmpegPath();
    if (ffmpeg && ffmpeg !== 'ffmpeg') {
        args.push('--ffmpeg-location', path.dirname(ffmpeg));
    }
    await appendCookieArgs(args);
    args.push(url);

    return new Promise((resolve, reject) => {
        const proc = spawn(ytdlp, args);
        let stderr = '';
        const items = [];
        let buffer = '';
        let killed = false;

        // Process timeout - 3 minutes for large playlists
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
                reject(new Error('Playlist fetch timed out after 3 minutes'));
            }
        }, 180000);

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
    return false;
}

module.exports = {
    checkDeps,
    fetchInfo,
    fetchPlaylist,
    looksLikePlaylist,
    buildPresets,
    download,
};
