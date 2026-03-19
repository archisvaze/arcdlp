// Main Process
// Electron entry point. Window, IPC, app lifecycle.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const ytdlp = require('./ytdlp');
const cookies = require('./cookies');
const { queue } = require('./queue');
const { DEV_MODE, log, logError } = require('./utils');

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
        history: [],
    },
});

let mainWindow = null;

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

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        if (DEV_MODE) mainWindow.webContents.openDevTools({ mode: 'detach' });
        log('Window ready');
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    log('App starting, DEV_MODE:', DEV_MODE);
    log('Platform:', process.platform, process.arch);
    createWindow();

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

    filtered.unshift({
        info,
        presets,
        fetchedAt: Date.now(),
    });

    store.set('history', filtered.slice(0, MAX_HISTORY));
    log('History updated, total:', Math.min(filtered.length, MAX_HISTORY));
}

ipcMain.handle('history:get', () => {
    return store.get('history') || [];
});

ipcMain.handle('history:remove', (_e, videoId, extractorKey) => {
    const history = store.get('history') || [];
    const filtered = history.filter((h) => !(h.info.id === videoId && h.info.extractor_key === extractorKey));
    store.set('history', filtered);
    log('History entry removed:', extractorKey, videoId);
    return filtered;
});

ipcMain.handle('history:clear', () => {
    store.set('history', []);
    log('History cleared');
    return [];
});

ipcMain.handle('deps:check', () => {
    log('Checking dependencies...');
    return ytdlp.checkDeps();
});

ipcMain.handle('video:fetch', async (_e, url) => {
    log('Fetch requested:', url);
    send('log', 'Fetching video info...');

    try {
        const { info, raw } = await ytdlp.fetchInfo(url, {
            onLog: (msg) => send('log', msg),
        });
        const presets = ytdlp.buildPresets(info.formats);
        send('log', `Found: ${info.title}`);
        log('Presets:', presets.map((p) => p.label).join(', '));

        addToHistory(info, presets);

        return { info, presets, raw };
    } catch (err) {
        send('log', `Error: ${err.message}`);
        throw err;
    }
});

ipcMain.handle('settings:getDownloadPath', () => store.get('downloadPath'));

ipcMain.handle('settings:chooseDownloadPath', async () => {
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

ipcMain.handle('settings:openFolder', (_e, p) => {
    shell.openPath(p || store.get('downloadPath'));
});

ipcMain.handle('settings:openExternal', (_e, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        shell.openExternal(url);
    }
});

ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    devMode: DEV_MODE,
    platform: process.platform,
    arch: process.arch,
}));

// Auth

ipcMain.handle('auth:check', () => cookies.hasCookies());

ipcMain.handle('auth:login', async () => {
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

ipcMain.handle('auth:logout', async () => {
    await cookies.clearCookies();
    send('log', 'Signed out of YouTube');
    log('YouTube logout');
    return true;
});

// Playlist

ipcMain.handle('playlist:fetch', async (_e, url) => {
    log('Playlist fetch requested:', url);
    send('log', 'Fetching playlist...');

    try {
        const result = await ytdlp.fetchPlaylist(url, {
            onLog: (msg) => send('log', msg),
            onItem: (item, count) => send('playlist:item', { item, count }),
        });

        send('log', `Playlist: ${result.items.length} items found`);
        log('Playlist items:', result.items.length);
        return result;
    } catch (err) {
        send('log', `Error: ${err.message}`);
        throw err;
    }
});

ipcMain.handle('playlist:detect', (_e, url) => {
    return ytdlp.looksLikePlaylist(url);
});

// Queue

ipcMain.handle('queue:add', (_e, items) => {
    log('Queue: adding', items.length, 'items');
    return queue.add(items);
});

ipcMain.handle('queue:getAll', () => {
    return queue.getAll();
});

ipcMain.handle('queue:getCounts', () => {
    return queue.counts;
});

ipcMain.handle('queue:cancelCurrent', () => {
    queue.cancelCurrent();
    return { ok: true };
});

ipcMain.handle('queue:cancelAll', () => {
    queue.cancelAll();
    return { ok: true };
});

ipcMain.handle('queue:retry', (_e, itemId) => {
    queue.retry(itemId);
    return { ok: true };
});

ipcMain.handle('queue:retryFailed', () => {
    queue.retryFailed();
    return { ok: true };
});

ipcMain.handle('queue:clearCompleted', () => {
    queue.clearCompleted();
    return { ok: true };
});

ipcMain.handle('queue:remove', (_e, itemId) => {
    queue.remove(itemId);
    return { ok: true };
});
