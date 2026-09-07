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
        this._completedRun = 0; // completed/failed since processing started
        this._failedRun = 0;
        this._downloadPath = null;
        this._videoCodec = 'auto';
    }

    // Register callbacks (call once from main.js)
    setCallbacks(cbs) {
        this._callbacks = cbs;
    }

    // Set download path (call from main.js, and whenever it changes)
    setDownloadPath(p) {
        this._downloadPath = p;
    }

    // Set the preferred video codec (call from main.js).
    // Items snapshot this when added, so changing it mid-queue only affects new items.
    setVideoCodec(c) {
        this._videoCodec = c || 'auto';
    }

    // Add one or more items to the queue. Each item: { url, title, formatId extractAudio, audioFormat, thumbnail, videoCodec }
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
                embedChapters: item.embedChapters || false,
                splitChapters: item.splitChapters || false,
                videoCodec: item.videoCodec || this._videoCodec || 'auto',
                duration: item.duration || null,
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
        return {
            total: this._items.length,
            pending,
            downloading,
            completed,
            failed,
        };
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
            this._completedRun = 0;
            this._failedRun = 0;
            return;
        }

        this._isProcessing = true;
        nextItem.state = STATE.DOWNLOADING;
        nextItem.progress = { percent: '0%', speed: '', eta: '', phase: 'download', ppStep: '' };
        this._emitItemUpdate(nextItem);
        this._emitQueueUpdate();

        // Completed items leave the queue and failed items stay put, so the list
        // alone is not a reliable total. Derive the batch size from the run
        // counters plus whatever is still pending/downloading.
        const counts = this.counts;
        const total = this._completedRun + this._failedRun + counts.pending + counts.downloading;
        const position = this._completedRun + this._failedRun + 1;
        this._emit('log', `Downloading ${position}/${total}: ${nextItem.title}`);

        try {
            this._cancelled = false;
            await this._downloadOne(nextItem);
            nextItem.state = STATE.COMPLETED;
            nextItem.progress = { percent: '100%', speed: '', eta: '', phase: 'done', ppStep: '' };
            this._completedRun++;
            this._emit('log', `Completed: ${nextItem.title} ✓`);
            log('Queue: completed', nextItem.title);
            this._emitItemComplete(nextItem);

            // Completed downloads leave the queue right away; history keeps
            // them instead, so the list only shows what is still to do.
            this._items = this._items.filter((i) => i.id !== nextItem.id);
        } catch (err) {
            this._failedRun++;
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
        if (this._items.includes(nextItem)) {
            this._emitItemUpdate(nextItem);
        }
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
            onSpawn: (proc) => {
                this._currentProc = proc;
            },
        };

        const downloadPromise = ytdlp.download(
            {
                url: item.url,
                formatId: item.formatId,
                outputDir: downloadPath,
                extractAudio: item.extractAudio,
                audioFormat: item.audioFormat,
                videoCodec: item.videoCodec,
                embedChapters: item.embedChapters,
                splitChapters: item.splitChapters,
                duration: item.duration,
            },
            callbacks,
        );

        return downloadPromise;
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
                completedRun: this._completedRun,
                failedRun: this._failedRun,
            });
        }
    }
}

const queue = new DownloadQueue();
module.exports = { queue, STATE };
