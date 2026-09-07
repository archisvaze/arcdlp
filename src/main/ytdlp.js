// yt-dlp Engine
// Handles: binary resolution, video info fetching, downloading with structured progress output.

const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { log, logError } = require('./utils');
const cookies = require('./cookies');

// Video codec preference.
// 'auto' keeps yt-dlp's own ranking. The rest are expressed through --format-sort
// rather than a hard [vcodec^=...] filter, so a download never fails when the
// requested codec is missing - it just falls back to the next best format.
const VIDEO_CODEC_SORT = {
    h264: 'vcodec:h264',
    vp9: 'vcodec:vp9,acodec:opus',
    av1: 'vcodec:av01',
};

// The container each codec muxes into most reliably.
// VP9 goes to WebM with Opus audio.
const VIDEO_CODEC_CONTAINER = {
    h264: 'mp4',
    vp9: 'webm',
    av1: 'mp4',
};

const VIDEO_CODEC_LABELS = {
    auto: 'Auto',
    h264: 'H.264',
    vp9: 'VP9',
    av1: 'AV1',
};

// Post-processor lines tell us what yt-dlp is doing after the download hits
// 100%. During these stages yt-dlp prints no progress lines at all, so without
// tracking them the progress bar freezes on the last "100% - ETA NA" line.
const PP_STEPS = {
    '[Merger]': 'Merging streams',
    '[ExtractAudio]': 'Extracting audio',
    '[VideoConvertor]': 'Converting video',
    '[VideoRemuxer]': 'Remuxing video',
    '[EmbedChapters]': 'Embedding chapters',
    '[SplitChapters]': 'Splitting chapters',
    '[Metadata]': 'Adding metadata',
    '[EmbedThumbnail]': 'Embedding thumbnail',
    '[ThumbnailsConvertor]': 'Converting thumbnail',
};

// Map a yt-dlp output line to a friendly processing step, or null if it is not
// a post-processor line.
function postProcessStep(trimmed) {
    if (!trimmed || !trimmed.startsWith('[')) return null;
    for (const [prefix, step] of Object.entries(PP_STEPS)) {
        if (trimmed.startsWith(prefix)) return step;
    }
    if (trimmed.startsWith('[Fixup')) return 'Polishing file';
    return null;
}

// Steps where ffmpeg actually re-encodes audio/video, so the -progress file
// tracks real time. Embedding/splitting chapters are fast remuxes that each
// restart ffmpeg and would make the percentage jump backwards.
const ENCODE_STEPS = new Set(['Merging streams', 'Extracting audio', 'Converting video']);

// Extract a full file path from a post-processor destination line. yt-dlp uses
// either "Destination: <path>" or "Merging formats into \"<path>\"".
function postProcessPath(trimmed) {
    let m = trimmed.match(/Destination: "?(.+?)"?\s*$/);
    if (!m) m = trimmed.match(/Merging formats into "(.+)"\s*$/);
    return m ? m[1].trim() : null;
}

// yt-dlp reports speed as "Unknown B/s" and ETA as "NA"/"Unknown" when it
// cannot tell. Strip those before the value reaches the UI or log, and round
// the numbers so the progress line stays short.
function cleanReportedSpeed(s) {
    if (!s) return '';
    const t = String(s).trim();
    if (!t || /unknown|na/i.test(t)) return '';
    const m = t.match(/^([\d.]+)(.*)$/);
    if (!m) return t;
    const n = parseFloat(m[1]);
    return (Number.isFinite(n) ? String(Math.round(n)) : m[1]) + m[2];
}

function cleanReportedEta(e) {
    if (!e) return '';
    const t = String(e).trim();
    if (!t || /unknown|na/i.test(t)) return '';
    return t;
}

// Does a yt-dlp vcodec string belong to the requested codec family?
function matchesVideoCodec(vcodec, codec) {
    if (!codec || codec === 'auto') return true;
    if (!vcodec || vcodec === 'none') return false;
    const v = String(vcodec).toLowerCase();
    if (codec === 'h264') return v.startsWith('avc') || v.startsWith('h264') || v.startsWith('h.264');
    if (codec === 'vp9') return v.startsWith('vp9') || v.startsWith('vp09');
    if (codec === 'av1') return v.startsWith('av01') || v.startsWith('av1');
    return true;
}

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
        chapters: raw.chapters || [],
        _fetched_at: Date.now(),
    };
}

function buildPresets(formats, videoCodec = 'auto') {
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
        const atHeight = formats.filter((f) => f.height === h && f.filesize);
        if (atHeight.length === 0) return null;
        // Prefer sizes from the requested codec - AV1 and VP9 are meaningfully
        // smaller than H.264 at the same height, so a mixed max reads high.
        // If nothing matches, fall back to any format so a size still shows.
        const matching = atHeight.filter((f) => matchesVideoCodec(f.vcodec, videoCodec));
        const pool = matching.length > 0 ? matching : atHeight;
        return Math.max(...pool.map((f) => f.filesize));
    }

    // Some sites report vcodec as 'none' on every stream. A codec preference is
    // meaningless there, so don't flag anything as a fallback.
    const codecInfoAvailable = formats.some((f) => f.vcodec && f.vcodec !== 'none');

    // Is the requested codec actually offered at this height?
    function hasCodecAtHeight(h) {
        if (!videoCodec || videoCodec === 'auto' || !codecInfoAvailable) return true;
        return formats.some((f) => f.height === h && matchesVideoCodec(f.vcodec, videoCodec));
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
            codecFallback: videoCodec !== 'auto' && codecInfoAvailable && !formats.some((f) => matchesVideoCodec(f.vcodec, videoCodec)),
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
            codecFallback: !hasCodecAtHeight(h),
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

    presets.push({
        id: 'audio-ogg',
        label: 'OGG',
        tag: '',
        size: formatBytes(audioSize((f) => f.acodec?.includes('vorbis') || f.acodec?.includes('opus'))),
        formatId: 'ba[acodec*=vorbis]/ba[acodec*=opus]/ba/b',
        type: 'audio',
        // yt-dlp calls the ogg container format "vorbis"
        audioFormat: 'vorbis',
    });

    presets.push({
        id: 'audio-wav',
        label: 'WAV',
        tag: '',
        size: formatBytes(audioSize(() => true)),
        formatId: 'ba/b',
        type: 'audio',
        audioFormat: 'wav',
    });

    return presets;
}

async function download({ url, formatId, outputDir, extractAudio, audioFormat, videoCodec, embedChapters, splitChapters, duration }, callbacks) {
    const { onProgress, onLog, onSpawn } = callbacks;

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
        'download:DLPROG %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
        '-o',
        path.join(outputDir, '%(title)s [%(id)s].%(ext)s'),
    ];

    const ffmpeg = getFfmpegPath();
    if (ffmpeg && ffmpeg !== 'ffmpeg') {
        args.push('--ffmpeg-location', path.dirname(ffmpeg));
    }

    // yt-dlp gives no percentage during post-processing, so we cheat: point
    // ffmpeg's -progress at a temp file and track out_time ourselves. The
    // renderer then shows a real percentage instead of an indeterminate bar.
    // yt-dlp's arg splitter chokes on backslash paths, so use forward slashes.
    const ppFile = path.join(os.tmpdir(), `arcdlp-pp-${process.pid}-${Date.now()}.txt`).replace(/\\/g, '/');
    const ppArgs = ['-progress', ppFile];

    if (extractAudio) {
        args.push('-x', '--audio-format', audioFormat || 'mp3', '--audio-quality', '0');
        args.push('--postprocessor-args', 'ffmpeg:' + ppArgs.join(' '));
    } else if (formatId) {
        const codec = videoCodec && VIDEO_CODEC_SORT[videoCodec] ? videoCodec : null;
        const container = codec ? VIDEO_CODEC_CONTAINER[codec] : 'mp4';

        args.push('-f', formatId);

        if (codec) {
            // Preference, not a filter. If the codec isn't offered, yt-dlp keeps
            // going with the next best format instead of failing the download.
            args.push('-S', VIDEO_CODEC_SORT[codec]);
            log('Codec preference:', codec, '->', VIDEO_CODEC_SORT[codec]);
            onLog(`Preferring ${VIDEO_CODEC_LABELS[codec]} video`);
        }

        args.push('--merge-output-format', container);

        if (container === 'mp4') {
            // Re-encode audio to AAC for universal playback.
            // YouTube serves Opus audio which Windows Media Player can't decode in MP4.
            // AAC is fast to encode and works on every player on every OS.
            ppArgs.push('-c:v copy', '-c:a aac');
            args.push('--postprocessor-args', 'ffmpeg:' + ppArgs.join(' '));
        } else {
            // WebM takes yt-dlp's default straight copy merge. AAC is not valid in
            // WebM, and the format sort above already biases audio to Opus.
            args.push('--postprocessor-args', 'ffmpeg:' + ppArgs.join(' '));
        }
    }

    // Chapter handling. Embedding adds chapter markers to the file, splitting
    // writes each chapter as its own file. Split already implies embed, so we
    // only pass one flag. Both need ffmpeg to remux.
    if (splitChapters || embedChapters) {
        const hasFfmpeg = ffmpeg && ffmpeg !== 'ffmpeg';
        if (hasFfmpeg) {
            if (splitChapters) {
                args.push('--split-chapters');
            } else {
                args.push('--embed-chapters');
            }
        } else {
            onLog('Chapter options need ffmpeg, skipping them for this download.');
        }
    }

    await appendCookieArgs(args, url);
    args.push(url);
    log('Download args:', args.join(' '));

    return new Promise((resolve, reject) => {
        // cwd matters: --split-chapters writes chapter files relative to the
        // working directory, not the -o path. Without this they'd end up in
        // the app folder instead of the chosen download folder.
        const proc = spawn(ytdlp, args, { env: getSpawnEnv(), cwd: outputDir });

        // Active download state. Progress lines update it, and post-processor
        // lines switch the phase so the UI can show what is happening.
        const state = { percent: '0%', percentNum: 0, speed: '', eta: '', phase: 'download', ppStep: '', encodePct: null };
        // When --split-chapters runs, yt-dlp keeps the whole file as a
        // "non-destructive" leftover. Track the full-file path so we can
        // delete it after the chapter files are written.
        let mainOutputFile = null;
        let splitProducedChapters = false;

        function emitProgress() {
            onProgress({ ...state });
        }

        // Real post-process percentage. yt-dlp prints no numbers, so track the
        // ffmpeg -progress file we injected: out_time vs the media duration.
        let ppTimer = null;
        function startPpPolling() {
            if (ppTimer || !duration) return;
            ppTimer = setInterval(() => {
                try {
                    if (state.phase !== 'processing' || !ENCODE_STEPS.has(state.ppStep)) return;
                    const txt = fs.readFileSync(ppFile, 'utf8');
                    const m = txt.match(/out_time_us=(\d+)/g);
                    if (!m) return;
                    const lastUs = parseInt(m[m.length - 1].split('=')[1], 10) || 0;
                    const totalUs = duration * 1000000;
                    const pct = lastUs > 0 ? Math.min(100, (lastUs / totalUs) * 100) : 0;
                    if (Math.abs(pct - (state.encodePct || 0)) >= 1) {
                        state.encodePct = Math.round(pct);
                        emitProgress();
                    }
                } catch {
                    // File not ready yet; keep polling
                }
            }, 500);
        }
        function stopPpPolling() {
            if (ppTimer) {
                clearInterval(ppTimer);
                ppTimer = null;
            }
            try {
                fs.unlinkSync(ppFile);
            } catch {
                /* */
            }
        }

        // Parse progress from both stdout and stderr
        function parseOutput(data) {
            const text = data.toString();
            const lines = text.split('\n');
            for (const line of lines) {
                if (line.startsWith('DLPROG ')) {
                    // Pipe-separated fields: speed values can contain spaces
                    // ("Unknown B/s"), so whitespace splitting shifts columns.
                    const parts = line.slice(7).trim().split('|');
                    state.percent = (parts[0] || '0%').trim();
                    state.percentNum = parseFloat(state.percent) || 0;
                    state.speed = cleanReportedSpeed((parts[1] || '').trim());
                    state.eta = cleanReportedEta((parts[2] || '').trim());
                    state.phase = 'download';
                    state.ppStep = '';
                    log('Progress:', Math.round(state.percentNum) + '%', state.speed || '-', state.eta || '-');
                    emitProgress();
                    continue;
                }

                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('WARNING')) continue;

                const step = postProcessStep(trimmed);
                if (step || trimmed.startsWith('Deleting')) {
                    // Only claim the encoding phase once the file is actually
                    // downloaded, so unrelated [Merger]/[info] noise during
                    // early progress is never mistaken for post-processing.
                    if (step && state.percentNum >= 100) {
                        state.phase = 'processing';
                        state.ppStep = step;
                        if (ENCODE_STEPS.has(step)) {
                            startPpPolling();
                        } else {
                            // Remux/embed/split are instant; clear the encode
                            // fill so the UI falls back to an indeterminate bar.
                            state.encodePct = null;
                        }
                    } else if (trimmed.startsWith('Deleting')) {
                        state.phase = 'cleanup';
                        state.ppStep = '';
                    }
                    if (trimmed.startsWith('[SplitChapters] Chapter') && !trimmed.includes('unavailable')) {
                        splitProducedChapters = true;
                    } else {
                        const dest = postProcessPath(trimmed);
                        if (dest) mainOutputFile = dest;
                    }

                    onLog(trimmed);
                    emitProgress();
                    continue;
                }

                if (trimmed.startsWith('[download]') || trimmed.startsWith('[info]')) {
                    onLog(trimmed);
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
            stopPpPolling();
            if (code !== 0) {
                const msg = stderrBuf.trim() || `yt-dlp exited with code ${code}`;
                logError('Download failed:', msg);
                onLog('Download failed.');
                return reject(new Error(msg));
            }
            log('Download completed');
            onLog('Download complete ✓');
            if (splitProducedChapters && mainOutputFile) {
                // --split-chapters is non-destructive: yt-dlp leaves the full
                // file next to the chapter files. The user asked for chapters,
                // so drop the redundant copy now that the split succeeded.
                try {
                    fs.unlinkSync(mainOutputFile);
                    log('Removed full file after chapter split:', mainOutputFile);
                } catch (e) {
                    log('Could not remove full file after split:', e.message);
                }
            }
            resolve({ ok: true });
        });

        proc.on('error', (err) => {
            // Spawn failed before any output; no 'close' will fire, so clean up
            // the interval and the temp progress file here as well.
            stopPpPolling();
            logError('Download spawn error:', err.message);
            reject(new Error(`Cannot run yt-dlp: ${err.message}`));
        });

        if (onSpawn) onSpawn(proc);
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
    VIDEO_CODEC_LABELS,
    checkDeps,
    getVersions,
    fetchInfo,
    fetchPlaylist,
    looksLikePlaylist,
    buildPresets,
    download,
};
