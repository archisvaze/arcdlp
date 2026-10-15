// Main Process
// Electron entry point. Window, IPC, app lifecycle.

const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const Store = require('electron-store');
const ytdlp = require('./ytdlp');
const ytdlpUpdate = require('./ytdlp-update');
const cookies = require('./cookies');
const { queue } = require('./queue');
const updater = require('./updater');
const scraper = require('./scraper');
const { DEV_MODE, log, logError } = require('./utils');
const fs = require('fs');
const APP_NAME = 'ArcDLP';

process.on('uncaughtException', (err) => {
    logError('Uncaught exception:', err.message);
    send('log', `Error: ${err.message}`);
});

process.on('unhandledRejection', (err) => {
    logError('Unhandled rejection:', err?.message || err);
    send('log', `Error: ${err?.message || 'Unknown error'}`);
});

const store = new Store({
    name: 'app-config',
    defaults: {
        downloadPath: path.join(app.getPath('downloads'), APP_NAME),
        videoCodec: 'auto',
        proxyUrl: '',
        history: [],
    },
});

let mainWindow = null;
let cachedVersions = { ytdlp: null, ffmpeg: null, deno: null };

// Only the app's own page may call into the main process
function isTrustedSender(e) {
    try {
        return new URL(e.senderFrame.url).protocol === 'file:';
    } catch {
        return false;
    }
}

function handle(channel, fn) {
    ipcMain.handle(channel, (e, ...args) => {
        if (!isTrustedSender(e)) throw new Error('Blocked IPC call from an untrusted page');
        return fn(e, ...args);
    });
}

function send(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

function createWindow() {
    const isMac = process.platform === 'darwin';

    mainWindow = new BrowserWindow({
        width: 900,
        height: 640,
        minWidth: 700,
        minHeight: 500,
        backgroundColor: isMac ? '#00000000' : '#f5f5f7',
        titleBarStyle: isMac ? 'hiddenInset' : 'default',
        ...(isMac ? { trafficLightPosition: { x: 16, y: 18 } } : {}),
        ...(isMac ? { vibrancy: 'under-window' } : {}),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: DEV_MODE,
        },
        show: false,
    });

    // The window never leaves the app page. Dropped links and new windows would otherwise get the preload API.
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (DEV_MODE) mainWindow.webContents.openDevTools({ mode: 'detach' });
        log('Window ready');

        // Check for updates after a 3 sec
        setTimeout(async () => {
            try {
                const result = await updater.checkForUpdates(app.getVersion());
                if (result.hasUpdate) {
                    log('Update available:', result.latest);
                    send('update-available', result);
                }
            } catch (err) {
                logError('Startup update check failed:', err.message);
            }
        }, 3000);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    log('App starting, DEV_MODE:', DEV_MODE);
    log('Platform:', process.platform, process.arch);
    cookies.purgeCookieFiles();
    ytdlp.setProxyUrl(store.get('proxyUrl'));
    createWindow();

    // Fetch dependency versions in the background
    ytdlp
        .getVersions()
        .then((v) => {
            cachedVersions = v;
            log('Versions cached:', JSON.stringify(v));
        })
        .catch((err) => {
            logError('Version fetch failed:', err.message);
        });

    // Wire queue callbacks to renderer
    queue.setCallbacks({
        onLog: (msg) => send('log', msg),
        onItemUpdate: (item) => send('queue:itemUpdate', item),
        onQueueUpdate: (data) => send('queue:update', data),
        onItemComplete: (item) => {
            // Add completed downloads to history, skip if already there
            const history = store.get('history') || [];
            const alreadyExists = history.some((h) => h.info.webpage_url === item.url);
            if (!alreadyExists) {
                addToHistory(
                    {
                        id: item.url,
                        title: item.title,
                        thumbnail: item.thumbnail,
                        extractor_key: 'download',
                        webpage_url: item.url,
                    },
                    [],
                );
            }
        },
    });
    queue.setDownloadPath(store.get('downloadPath'));
    queue.setVideoCodec(store.get('videoCodec') || 'auto');

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    // Kill any running yt-dlp process to prevent orphans
    queue.cancelCurrent();
});

// Max 50 history entries, deduped by video id + extractor
const MAX_HISTORY = 50;

function addToHistory(info, presets) {
    const history = store.get('history') || [];
    const key = `${info.extractor_key}:${info.id}`;

    // Remove existing entry for same video
    const filtered = history.filter((h) => `${h.info.extractor_key}:${h.info.id}` !== key);

    // History never uses these and they make every save large
    const { formats, description, tags, categories, ...slim } = info;

    filtered.unshift({
        info: slim,
        presets,
        fetchedAt: Date.now(),
    });

    store.set('history', filtered.slice(0, MAX_HISTORY));
    log('History updated, total:', Math.min(filtered.length, MAX_HISTORY));
}

handle('history:get', () => {
    return store.get('history') || [];
});

handle('history:remove', (_e, videoId, extractorKey) => {
    const history = store.get('history') || [];
    const filtered = history.filter((h) => !(h.info.id === videoId && h.info.extractor_key === extractorKey));
    store.set('history', filtered);
    log('History entry removed:', extractorKey, videoId);
    return filtered;
});

handle('history:clear', () => {
    store.set('history', []);
    log('History cleared');
    return [];
});

handle('deps:check', () => {
    log('Checking dependencies...');
    return ytdlp.checkDeps();
});

handle('deps:versions', () => {
    return cachedVersions;
});

handle('deps:updateYtdlp', async () => {
    if (queue.isActive) throw new Error('Wait for the queue to finish before updating yt-dlp');
    send('log', 'Checking for a newer yt-dlp...');
    const result = await ytdlpUpdate.updateYtdlp(cachedVersions.ytdlp);
    if (result.updated) {
        cachedVersions = await ytdlp.getVersions();
        send('log', `yt-dlp updated to ${result.version} ✓`);
    } else {
        send('log', `yt-dlp is up to date (${result.version})`);
    }
    return result;
});

handle('video:fetch', async (_e, url) => {
    log('Fetch requested:', url);
    send('log', 'Fetching video info...');

    try {
        const result = await ytdlp.fetchInfo(url, {
            onLog: (msg) => send('log', msg),
        });

        // Several videos in one post, the renderer shows them in the playlist view
        if (result.playlist) {
            send('log', `Found ${result.playlist.items.length} videos in this post`);
            return { playlist: result.playlist };
        }

        const { info } = result;
        const videoCodec = store.get('videoCodec') || 'auto';
        const presets = ytdlp.buildPresets(info.formats, videoCodec);
        send('log', `Found: ${info.title}`);
        log('Presets:', presets.map((p) => p.label).join(', '));

        // Warn about qualities the chosen codec can't cover. YouTube tops H.264
        // out at 1080p, so a 4K pick will quietly come down to VP9 or AV1.
        if (videoCodec !== 'auto') {
            const missing = presets.filter((p) => p.type === 'video' && p.codecFallback).map((p) => p.label);
            if (missing.length > 0) {
                const label = ytdlp.VIDEO_CODEC_LABELS[videoCodec] || videoCodec;
                send('log', `${label} not available at: ${missing.join(', ')}. Best available codec will be used instead.`);
            }
        }

        addToHistory(info, presets);

        return { info, presets };
    } catch (err) {
        send('log', `Error: ${err.message}`);
        throw err;
    }
});

handle('settings:getDownloadPath', () => store.get('downloadPath'));

handle('settings:chooseDownloadPath', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return store.get('downloadPath');
    }
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose download folder',
    });
    if (!result.canceled && result.filePaths[0]) {
        store.set('downloadPath', result.filePaths[0]);
        queue.setDownloadPath(result.filePaths[0]);
        log('Download path changed:', result.filePaths[0]);
        return result.filePaths[0];
    }
    return store.get('downloadPath');
});

handle('settings:getVideoCodec', () => store.get('videoCodec') || 'auto');

handle('settings:setVideoCodec', (_e, codec) => {
    const allowed = ['auto', 'h264', 'vp9', 'av1'];
    const next = allowed.includes(codec) ? codec : 'auto';
    store.set('videoCodec', next);
    queue.setVideoCodec(next);
    log('Video codec preference:', next);
    return next;
});

handle('settings:openFolder', () => {
    shell.openPath(store.get('downloadPath'));
});

handle('settings:getProxy', () => store.get('proxyUrl') || '');

handle('settings:setProxy', (_e, url) => {
    const cleaned = String(url || '').trim();
    if (cleaned && !/^(https?|socks4a?|socks5h?):\/\/\S+$/i.test(cleaned)) {
        throw new Error('Use a proxy URL like socks5://127.0.0.1:1080');
    }
    store.set('proxyUrl', cleaned);
    ytdlp.setProxyUrl(cleaned);
    log('Proxy URL changed:', cleaned || '(none)');
    return cleaned;
});

handle('settings:openExternal', (_e, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        shell.openExternal(url);
    }
});

handle('app:info', () => ({
    version: app.getVersion(),
    devMode: DEV_MODE,
    platform: process.platform,
    arch: process.arch,
}));

handle('app:checkForUpdates', async () => {
    const result = await updater.checkForUpdates(app.getVersion());
    if (result.hasUpdate) {
        send('update-available', result);
    }
    return result;
});

// Auth

handle('auth:check', () => cookies.hasCookies());

handle('auth:login', async () => {
    log('Opening YouTube login window');
    send('log', 'Opening YouTube sign-in...');
    const success = await cookies.openLoginWindow(mainWindow);
    if (success) {
        send('log', 'Signed in to YouTube ✓');
        log('YouTube login successful');
    } else {
        send('log', 'Sign-in cancelled');
        log('YouTube login cancelled');
    }
    return success;
});

handle('auth:logout', async () => {
    await cookies.clearCookies();
    send('log', 'Signed out of YouTube');
    log('YouTube logout');
    return true;
});

// Instagram Auth

handle('insta:check', () => cookies.hasInstaCookies());

handle('insta:login', async () => {
    log('Opening Instagram login window');
    send('log', 'Opening Instagram sign-in...');
    const success = await cookies.openInstaLoginWindow(mainWindow);
    if (success) {
        send('log', 'Signed in to Instagram ✓');
        log('Instagram login successful');
    } else {
        send('log', 'Instagram sign-in cancelled');
        log('Instagram login cancelled');
    }
    return success;
});

handle('insta:logout', async () => {
    await cookies.clearInstaCookies();
    send('log', 'Signed out of Instagram');
    log('Instagram logout');
    return true;
});

// Instagram Collection Scraper

handle('scraper:collection', async (_e, url) => {
    if (!scraper.isInstagramCollection(url)) throw new Error('Not an Instagram saved collection URL');
    log('Scraper: collection requested:', url);
    send('log', 'Scraping Instagram collection...');

    try {
        const result = await scraper.scrapeCollection(url, mainWindow, {
            onLog: (msg) => send('log', msg),
            onItem: (item, count) => send('scraper:item', { item, count }),
        });

        send('log', `Found ${result.items.length} posts in collection`);
        log('Scraper: found', result.items.length, 'items');
        return result;
    } catch (err) {
        send('log', `Scraper error: ${err.message}`);
        throw err;
    }
});

// Playlist

let playlistProc = null;
let playlistCancelled = false;

handle('playlist:fetch', async (_e, url) => {
    log('Playlist fetch requested:', url);
    send('log', 'Fetching playlist...');
    playlistCancelled = false;

    try {
        const result = await ytdlp.fetchPlaylist(url, {
            onLog: (msg) => send('log', msg),
            onItem: (item, count) => send('playlist:item', { item, count }),
            onSpawn: (proc) => {
                playlistProc = proc;
            },
            isCancelled: () => playlistCancelled,
        });

        send('log', `Playlist: ${result.items.length} items found`);
        log('Playlist items:', result.items.length);
        return result;
    } catch (err) {
        send('log', `Error: ${err.message}`);
        throw err;
    } finally {
        playlistProc = null;
    }
});

// Stops a playlist fetch or collection scrape, items found so far are kept
handle('fetch:cancel', () => {
    playlistCancelled = true;
    if (playlistProc) {
        try {
            playlistProc.kill('SIGTERM');
        } catch {
            //
        }
    }
    scraper.cancelScrape();
    return { ok: true };
});

handle('playlist:detect', (_e, url) => {
    return ytdlp.looksLikePlaylist(url);
});

// Queue

handle('queue:add', (_e, items) => {
    log('Queue: adding', items.length, 'items');
    return queue.add(items);
});

handle('queue:getAll', () => {
    return queue.getAll();
});

handle('queue:getCounts', () => {
    return queue.counts;
});

handle('queue:cancelCurrent', () => {
    queue.cancelCurrent();
    return { ok: true };
});

handle('queue:cancelAll', () => {
    queue.cancelAll();
    return { ok: true };
});

handle('queue:retry', (_e, itemId) => {
    queue.retry(itemId);
    return { ok: true };
});

handle('queue:retryFailed', () => {
    queue.retryFailed();
    return { ok: true };
});

handle('queue:clearCompleted', () => {
    queue.clearCompleted();
    return { ok: true };
});

handle('queue:remove', (_e, itemId) => {
    queue.remove(itemId);
    return { ok: true };
});

handle('app:reset', async () => {
    try {
        const userDataPath = app.getPath('userData');
        log('Reset requested. userData:', userDataPath);

        // Clear sessions and settings through Electron first. Windows keeps some userData files
        // locked while the app runs, so deleting the folder alone can leave sign-ins behind.
        queue.cancelAll();
        await cookies.clearCookies().catch(() => {});
        await cookies.clearInstaCookies().catch(() => {});
        await session.defaultSession.clearStorageData().catch(() => {});
        store.clear();

        // Relaunch AFTER cleanup
        setTimeout(() => {
            try {
                fs.rmSync(userDataPath, { recursive: true, force: true });
                log('User data deleted');
            } catch (err) {
                logError('Failed deleting userData:', err.message);
            }

            app.relaunch();
            app.exit(0);
        }, 100);

        return { ok: true };
    } catch (err) {
        logError('Reset failed:', err.message);
        return { ok: false, error: err.message };
    }
});
