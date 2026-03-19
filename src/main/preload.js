// Preload Context Bridge
// Exposes a safe API to the renderer process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    fetchVideo: (url) => ipcRenderer.invoke('video:fetch', url),

    checkDeps: () => ipcRenderer.invoke('deps:check'),

    getDownloadPath: () => ipcRenderer.invoke('settings:getDownloadPath'),
    chooseDownloadPath: () => ipcRenderer.invoke('settings:chooseDownloadPath'),
    openFolder: (p) => ipcRenderer.invoke('settings:openFolder', p),
    openExternal: (url) => ipcRenderer.invoke('settings:openExternal', url),

    getAppInfo: () => ipcRenderer.invoke('app:info'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),

    // History
    getHistory: () => ipcRenderer.invoke('history:get'),
    removeHistory: (videoId, extractorKey) => ipcRenderer.invoke('history:remove', videoId, extractorKey),
    clearHistory: () => ipcRenderer.invoke('history:clear'),

    // Auth
    checkAuth: () => ipcRenderer.invoke('auth:check'),
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),

    // Playlist
    fetchPlaylist: (url) => ipcRenderer.invoke('playlist:fetch', url),
    detectPlaylist: (url) => ipcRenderer.invoke('playlist:detect', url),

    // Queue
    queueAdd: (items) => ipcRenderer.invoke('queue:add', items),
    queueGetAll: () => ipcRenderer.invoke('queue:getAll'),
    queueGetCounts: () => ipcRenderer.invoke('queue:getCounts'),
    queueCancelCurrent: () => ipcRenderer.invoke('queue:cancelCurrent'),
    queueCancelAll: () => ipcRenderer.invoke('queue:cancelAll'),
    queueRetry: (itemId) => ipcRenderer.invoke('queue:retry', itemId),
    queueRetryFailed: () => ipcRenderer.invoke('queue:retryFailed'),
    queueClearCompleted: () => ipcRenderer.invoke('queue:clearCompleted'),
    queueRemove: (itemId) => ipcRenderer.invoke('queue:remove', itemId),

    onLog: (cb) => {
        const handler = (_e, msg) => cb(msg);
        ipcRenderer.on('log', handler);
        return () => ipcRenderer.removeListener('log', handler);
    },
    onQueueUpdate: (cb) => {
        const handler = (_e, data) => cb(data);
        ipcRenderer.on('queue:update', handler);
        return () => ipcRenderer.removeListener('queue:update', handler);
    },
    onQueueItemUpdate: (cb) => {
        const handler = (_e, item) => cb(item);
        ipcRenderer.on('queue:itemUpdate', handler);
        return () => ipcRenderer.removeListener('queue:itemUpdate', handler);
    },
    onPlaylistItem: (cb) => {
        const handler = (_e, data) => cb(data);
        ipcRenderer.on('playlist:item', handler);
        return () => ipcRenderer.removeListener('playlist:item', handler);
    },
    onUpdateAvailable: (cb) => {
        const handler = (_e, data) => cb(data);
        ipcRenderer.on('update-available', handler);
        return () => ipcRenderer.removeListener('update-available', handler);
    },
});
