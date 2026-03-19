// Download Queue
// Sequential queue with per-item state, retry, and resilience.
// One failure never kills the rest.

const { log, logError } = require('./utils');

// Item states
const STATE = {
    PENDING: 'pending',
    DOWNLOADING: 'downloading',
    COMPLETED: 'completed',
    FAILED: 'failed',
};

class DownloadQueue {
    constructor() {
        this._items = [];
        this._isProcessing = false;
        this._aborted = false; // "cancel all" flag
        this._callbacks = null; // onProgress, onLog, onItemUpdate, onQueueUpdate
        this._currentProc = null; // ref to kill on cancel
        this._idCounter = 0;
        this._downloadPath = null;
    }

    // Register callbacks (call once from main.js)
    setCallbacks(cbs) {
        this._callbacks = cbs;
    }

    // Set download path (call from main.js, and whenever it changes)
    setDownloadPath(p) {
        this._downloadPath = p;
    }

    // Add one or more items to the queue. Each item: { url, title, formatId extractAudio, audioFormat, thumbnail }
    add(items) {
        const added = [];
        for (const item of items) {
            const qItem = {
                id: ++this._idCounter,
                url: item.url,
                title: item.title || 'Untitled',
                thumbnail: item.thumbnail || null,
                formatId: item.formatId,
                extractAudio: item.extractAudio || false,
                audioFormat: item.audioFormat || 'mp3',
                state: STATE.PENDING,
                error: null,
                progress: null, // { percent, speed, eta }
                addedAt: Date.now(),
            };
            this._items.push(qItem);
            added.push(qItem);
            log('Queue: added', qItem.title, '->', qItem.id);
        }

        this._emitQueueUpdate();

        // Auto-start if not already processing
        if (!this._isProcessing) {
            this._processNext();
        }

        return added;
    }

    getAll() {
        return this._items.map((item) => ({ ...item }));
    }

    cancelCurrent() {
        if (this._currentProc) {
            log('Queue: cancelling current');
            this._cancelled = true;
            try {
                this._currentProc.kill('SIGTERM');
            } catch {
                //
            }
            this._currentProc = null;
        }
    }

    cancelAll() {
        log('Queue: cancel all');
        this._aborted = true;
        this.cancelCurrent();

        // Mark pending items as failed
        for (const item of this._items) {
            if (item.state === STATE.PENDING) {
                item.state = STATE.FAILED;
                item.error = 'Cancelled';
            }
        }

        this._isProcessing = false;
        this._emitQueueUpdate();
    }

    retry(itemId) {
        const item = this._items.find((i) => i.id === itemId);
        if (!item || item.state !== STATE.FAILED) return;

        log('Queue: retrying', item.title);
        item.state = STATE.PENDING;
        item.error = null;
        item.progress = null;
        this._emitQueueUpdate();

        if (!this._isProcessing) {
            this._processNext();
        }
    }

    retryFailed() {
        let count = 0;
        for (const item of this._items) {
            if (item.state === STATE.FAILED) {
                item.state = STATE.PENDING;
                item.error = null;
                item.progress = null;
                count++;
            }
        }
        log('Queue: retrying', count, 'failed items');
        this._emitQueueUpdate();

        if (!this._isProcessing && count > 0) {
            this._processNext();
        }
    }

    clearCompleted() {
        this._items = this._items.filter((i) => i.state === STATE.PENDING || i.state === STATE.DOWNLOADING);
        // Reset id counter if queue is empty
        if (this._items.length === 0) this._idCounter = 0;
        this._emitQueueUpdate();
    }

    remove(itemId) {
        const item = this._items.find((i) => i.id === itemId);
        if (!item) return;

        if (item.state === STATE.DOWNLOADING) {
            this.cancelCurrent();
        }

        this._items = this._items.filter((i) => i.id !== itemId);
        this._emitQueueUpdate();
    }

    get isActive() {
        return this._isProcessing;
    }

    get counts() {
        let pending = 0,
            downloading = 0,
            completed = 0,
            failed = 0;
        for (const item of this._items) {
            if (item.state === STATE.PENDING) pending++;
            else if (item.state === STATE.DOWNLOADING) downloading++;
            else if (item.state === STATE.COMPLETED) completed++;
            else if (item.state === STATE.FAILED) failed++;
        }
        return { total: this._items.length, pending, downloading, completed, failed };
    }

    // Internal

    async _processNext() {
        if (this._aborted) {
            this._aborted = false;
            this._isProcessing = false;
            return;
        }

        // Find next pending item
        const nextItem = this._items.find((i) => i.state === STATE.PENDING);
        if (!nextItem) {
            this._isProcessing = false;
            log('Queue: all done');
            this._emit('log', 'Queue complete');
            this._emitQueueUpdate();
            return;
        }

        this._isProcessing = true;
        nextItem.state = STATE.DOWNLOADING;
        nextItem.progress = { percent: '0%', speed: '', eta: '' };
        this._emitItemUpdate(nextItem);
        this._emitQueueUpdate();

        const counts = this.counts;
        const position = counts.completed + counts.failed + 1;
        const total = counts.total;
        this._emit('log', `Downloading ${position}/${total}: ${nextItem.title}`);

        try {
            this._cancelled = false;
            await this._downloadOne(nextItem);
            nextItem.state = STATE.COMPLETED;
            nextItem.progress = { percent: '100%', speed: '', eta: '' };
            this._emit('log', `Completed: ${nextItem.title} ✓`);
            log('Queue: completed', nextItem.title);
            this._emitItemComplete(nextItem);
        } catch (err) {
            if (this._cancelled) {
                nextItem.state = STATE.FAILED;
                nextItem.error = 'Cancelled';
                this._emit('log', `Skipped: ${nextItem.title}`);
                log('Queue: cancelled', nextItem.title);
            } else {
                nextItem.state = STATE.FAILED;
                nextItem.error = err.message || 'Download failed';
                this._emit('log', `Failed: ${nextItem.title} - ${nextItem.error}`);
                logError('Queue: failed', nextItem.title, err.message);
            }
            this._cancelled = false;
        }

        this._currentProc = null;
        this._emitItemUpdate(nextItem);
        this._emitQueueUpdate();

        // Continue to next, always, even after failure
        // Use setTimeout to avoid stack buildup on large queues
        setTimeout(() => this._processNext(), 0);
    }

    _downloadOne(item) {
        // Lazy-require to avoid circular deps
        const ytdlp = require('./ytdlp');
        const path = require('path');
        const fs = require('fs');

        // Get download path from the store passed during callback setup
        const downloadPath = this._downloadPath || require('path').join(require('electron').app.getPath('downloads'), 'ArcDLP');
        if (!fs.existsSync(downloadPath)) {
            fs.mkdirSync(downloadPath, { recursive: true });
        }

        const callbacks = {
            onProgress: (p) => {
                item.progress = p;
                this._emitItemUpdate(item);
            },
            onLog: (msg) => {
                this._emit('log', msg);
            },
        };

        const downloadPromise = ytdlp.download(
            {
                url: item.url,
                formatId: item.formatId,
                outputDir: downloadPath,
                extractAudio: item.extractAudio,
                audioFormat: item.audioFormat,
            },
            callbacks,
        );

        // Store proc ref so we can cancel
        this._currentProc = callbacks._proc;

        // Poll for proc ref (it's set async after spawn)
        const pollInterval = setInterval(() => {
            if (callbacks._proc) {
                this._currentProc = callbacks._proc;
                clearInterval(pollInterval);
            }
        }, 50);

        return downloadPromise.finally(() => clearInterval(pollInterval));
    }

    _emit(type, data) {
        if (!this._callbacks) return;
        if (type === 'log' && this._callbacks.onLog) {
            this._callbacks.onLog(data);
        }
    }

    _emitItemUpdate(item) {
        if (this._callbacks?.onItemUpdate) {
            this._callbacks.onItemUpdate({ ...item });
        }
    }

    _emitItemComplete(item) {
        if (this._callbacks?.onItemComplete) {
            this._callbacks.onItemComplete({ ...item });
        }
    }

    _emitQueueUpdate() {
        if (this._callbacks?.onQueueUpdate) {
            this._callbacks.onQueueUpdate({
                items: this.getAll(),
                counts: this.counts,
                isActive: this.isActive,
            });
        }
    }
}

const queue = new DownloadQueue();
module.exports = { queue, STATE };
