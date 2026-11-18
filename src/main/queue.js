// Downloads run one at a time. A failed or cancelled item never stops the rest.

const path = require('path');
const fs = require('fs');
const ytdlp = require('./ytdlp');
const { log, logError } = require('./utils');

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
        this._callbacks = null; // onLog, onItemUpdate, onQueueUpdate, onItemComplete
        this._currentProc = null; // yt-dlp process of the current item, killed on cancel
        this._idCounter = 0;
        this._downloadPath = null;
        this._videoCodec = 'auto';
    }

    setCallbacks(cbs) {
        this._callbacks = cbs;
    }

    setDownloadPath(p) {
        this._downloadPath = p;
    }

    // Items keep the codec they were added with, so a change mid-queue only affects new items
    setVideoCodec(c) {
        this._videoCodec = c || 'auto';
    }

    // items: [{ url, title, thumbnail, formatId, extractAudio, audioFormat, videoCodec, playlistItem, embedChapters, splitChapters }]
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
                videoCodec: item.videoCodec || this._videoCodec || 'auto',
                playlistItem: item.playlistItem || null,
                embedChapters: item.embedChapters || false,
                splitChapters: item.splitChapters || false,
                state: STATE.PENDING,
                error: null,
                progress: null, // { percent, speed, eta, stage }
                addedAt: Date.now(),
            };
            this._items.push(qItem);
            added.push(qItem);
            log('Queue: added', qItem.title, '->', qItem.id);
        }

        this._emitQueueUpdate();

        if (!this._isProcessing) {
            this._processNext();
        }

        return added;
    }

    getAll() {
        return this._items.map((item) => ({ ...item }));
    }

    cancelCurrent() {
        // An item can be downloading before yt-dlp has spawned, the flag covers that gap
        const downloading = this._items.some((i) => i.state === STATE.DOWNLOADING);
        if (!downloading && !this._currentProc) return;

        log('Queue: cancelling current');
        this._cancelled = true;
        if (this._currentProc) {
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
        this.cancelCurrent();

        for (const item of this._items) {
            if (item.state === STATE.PENDING) {
                item.state = STATE.FAILED;
                item.error = 'Cancelled';
            }
        }

        // Stay active until the cancelled yt-dlp has exited, so an item added or retried in the
        // meantime can't start a second download beside it. _processNext ends the run from there.
        if (this._isProcessing) this._aborted = true;
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
        // After Cancel all, stop quietly unless something was added after the cancel
        if (this._aborted) {
            this._aborted = false;
            if (!this._items.some((i) => i.state === STATE.PENDING)) {
                this._isProcessing = false;
                this._emitQueueUpdate();
                return;
            }
        }

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

                // Remove partial files, again a moment later in case yt-dlp still held them
                const partials = this._currentPartials || [];
                ytdlp.removePartialFiles(partials);
                setTimeout(() => ytdlp.removePartialFiles(partials), 2000);
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

        // Always move on to the next item, even after a failure
        setTimeout(() => this._processNext(), 0);
    }

    _downloadOne(item) {
        const downloadPath = this._downloadPath || path.join(require('electron').app.getPath('downloads'), 'ArcDLP');
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
            isCancelled: () => this._cancelled,
            partials: [],
        };
        this._currentPartials = callbacks.partials;

        return ytdlp.download(
            {
                url: item.url,
                formatId: item.formatId,
                outputDir: downloadPath,
                extractAudio: item.extractAudio,
                audioFormat: item.audioFormat,
                videoCodec: item.videoCodec,
                playlistItem: item.playlistItem,
                embedChapters: item.embedChapters,
                splitChapters: item.splitChapters,
            },
            callbacks,
        );
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
