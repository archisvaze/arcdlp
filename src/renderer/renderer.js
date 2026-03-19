let videoInfo = null;
let presets = [];
let selectedPreset = null;
let isFetching = false;
let historyCache = [];

let playlistItems = [];
let playlistSelected = new Set();
let isPlaylistMode = false;

let queueData = {
    items: [],
    counts: { total: 0, pending: 0, downloading: 0, completed: 0, failed: 0 },
    isActive: false,
};
let hasAutoSwitchedToQueue = false;

let isSignedIn = false;
let updateInfo = null;

const $ = (id) => document.getElementById(id);

const $url = $('urlInput');
const $fetchBtn = $('fetchBtn');
const $clearBtn = $('clearBtn');
const $error = $('errorMsg');
const $card = $('videoCard');
const $empty = $('emptyState');
const $thumbWrap = $('thumbWrap');
const $vThumb = $('vThumb');
const $vDuration = $('vDuration');
const $vTitle = $('vTitle');
const $vChannel = $('vChannel');
const $vMeta = $('vMeta');
const $vidFmts = $('videoFormats');
const $audFmts = $('audioFormats');
const $dlBtn = $('dlBtn');
const $logBody = $('logBody');

// History
const $historyList = $('historyList');
const $historyEmpty = $('historyEmpty');
const $historyToolbar = $('historyToolbar');
const $historyCountLabel = $('historyCountLabel');
const $historyCount = $('historyCount');

// Playlist
const $plCard = $('playlistCard');
const $plItems = $('playlistItems');
const $plItemCount = $('plItemCount');
const $plFormatSelect = $('plFormatSelect');
const $plDownloadBtn = $('plDownloadBtn');

// Queue
const $queueToolbar = $('queueToolbar');
const $queueItems = $('queueItems');
const $queueEmpty = $('queueEmpty');
const $queueStatus = $('queueStatus');
const $queueCount = $('queueCount');
const $qRetryFailedBtn = $('qRetryFailedBtn');
const $qClearDoneBtn = $('qClearDoneBtn');
const $qCancelAllBtn = $('qCancelAllBtn');

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === 'tab-' + tabId);
    });

    if (tabId === 'history') loadHistory();
    if (tabId === 'settings') loadSettings();
    if (tabId === 'about') loadAbout();
}

function addLog(msg, type = '') {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

    const line = document.createElement('div');
    line.className = 'log-line' + (type ? ' ' + type : '');
    line.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(msg)}`;
    $logBody.appendChild(line);
    $logBody.scrollTop = $logBody.scrollHeight;

    while ($logBody.children.length > 200) {
        $logBody.removeChild($logBody.firstChild);
    }
}

function clearLog() {
    $logBody.innerHTML = '';
    addLog('Log cleared');
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// IPC listeners
window.api.onLog((msg) => {
    let type = '';
    if (msg.includes('✓') || msg.includes('complete') || msg.includes('Completed:')) type = 'success';
    else if (msg.startsWith('Error') || msg.includes('failed') || msg.includes('Failed:')) type = 'error';
    else if (msg.startsWith('[') || msg.startsWith('Downloading ')) {
        type = 'highlight';
    }
    addLog(msg, type);
});

// Queue event listeners
window.api.onQueueUpdate((data) => {
    queueData = data;
    renderQueue();
    updateQueueCount();
});

window.api.onQueueItemUpdate((item) => {
    const idx = queueData.items.findIndex((i) => i.id === item.id);
    if (idx !== -1) queueData.items[idx] = item;
    renderQueueItem(item);
});

// Playlist streaming
window.api.onPlaylistItem(({ item, count }) => {
    // Update notification
    window.api.onUpdateAvailable((data) => {
        updateInfo = data;
        addLog(`Update available: v${data.latest}`, 'highlight');
        showUpdateBanner();
    });
    if (!playlistItems.find((i) => i.id === item.id)) {
        playlistItems.push(item);
        playlistSelected.add(item.id);
        appendPlaylistItem(item);
        $plItemCount.textContent = `${count} item${count !== 1 ? 's' : ''}`;
        updatePlDownloadBtn();
    }
});

$url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doFetch();
});

async function doFetch() {
    const url = $url.value.trim();
    if (!url) return;
    if (isFetching) return;

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        showError('Please enter a valid URL starting with http:// or https://');
        return;
    }

    hideError();
    hideCard();
    hidePlaylist();

    isFetching = true;
    $fetchBtn.disabled = true;
    $fetchBtn.innerHTML = '<span class="spinner"></span> Fetching';

    try {
        const isPlaylist = await window.api.detectPlaylist(url);

        if (isPlaylist) {
            addLog('Detected playlist URL, fetching items...', 'highlight');
            await fetchPlaylist(url);
        } else {
            addLog('Fetching video info...', 'highlight');
            await fetchSingleVideo(url);
        }
    } catch (err) {
        const msg = err.message || 'Failed to fetch';
        addLog('Fetch failed: ' + msg, 'error');

        // Reset any partially shown UI
        hideCard();
        hidePlaylist();
        $empty.style.display = 'block';

        if (isAuthError(msg)) {
            showAuthError();
        } else if (msg.includes('not found') || msg.includes('Cannot run')) {
            showError('yt-dlp binary not found. Run `npm install` to download it.');
        } else if (msg.includes('Unsupported URL') || msg.includes('No video formats')) {
            showError('This URL is not supported or the video is unavailable.');
        } else if (msg.includes('HTTP Error 403') || msg.includes('HTTP Error 429')) {
            showError('Access denied or rate limited. Try again later.');
        } else if (msg.includes('timed out') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) {
            showError('Network error. Check your internet connection.');
        } else {
            showError(msg);
        }
    } finally {
        isFetching = false;
        $fetchBtn.disabled = false;
        $fetchBtn.textContent = 'Fetch';
    }
}

function doClear() {
    $url.value = '';
    hideError();
    hideCard();
    hidePlaylist();
    $empty.style.display = 'block';
    videoInfo = null;
    presets = [];
    selectedPreset = null;
    $clearBtn.style.display = 'none';
    $url.focus();
}

function showClearBtn() {
    $clearBtn.style.display = '';
}

async function fetchSingleVideo(url) {
    const result = await window.api.fetchVideo(url);
    videoInfo = result.info;
    presets = result.presets;
    selectedPreset = null;
    isPlaylistMode = false;

    addLog(`Video: ${videoInfo.title}`, 'success');
    addLog(`${presets.length} quality options available`);

    showCard();
    showClearBtn();
    updateHistoryCount();
}

async function fetchPlaylist(url) {
    isPlaylistMode = true;
    playlistItems = [];
    playlistSelected = new Set();
    $plItems.innerHTML = '';

    showPlaylist();

    const result = await window.api.fetchPlaylist(url);

    for (const item of result.items) {
        if (!playlistItems.find((i) => i.id === item.id)) {
            playlistItems.push(item);
            playlistSelected.add(item.id);
            appendPlaylistItem(item);
        }
    }

    $plItemCount.textContent = `${playlistItems.length} item${playlistItems.length !== 1 ? 's' : ''}`;
    updatePlDownloadBtn();
    showPlaylistFooter();
    showClearBtn();
    addLog(`Playlist loaded: ${playlistItems.length} items`, 'success');
}

// Video Card
function showCard() {
    $empty.style.display = 'none';
    $plCard.classList.remove('visible');

    $thumbWrap.classList.remove('broken');
    $vThumb.src = '';
    if (videoInfo.thumbnail) {
        $vThumb.src = videoInfo.thumbnail;
        $vThumb.onerror = () => {
            $thumbWrap.classList.add('broken');
        };
    } else {
        $thumbWrap.classList.add('broken');
    }

    $vDuration.textContent = videoInfo.duration_string || '';
    $vDuration.style.display = videoInfo.duration_string ? 'block' : 'none';
    $vTitle.textContent = videoInfo.title || 'Untitled';
    $vChannel.textContent = videoInfo.uploader || videoInfo.channel || '';

    const meta = [];
    if (videoInfo.extractor_key) {
        meta.push(`<span class="meta-item"><span class="meta-badge">${escapeHtml(videoInfo.extractor_key)}</span></span>`);
    }
    if (videoInfo.live_status === 'is_live') {
        meta.push(`<span class="meta-item"><span class="meta-badge live">LIVE</span></span>`);
    }
    if (videoInfo.webpage_url_domain) {
        meta.push(`<span class="meta-item">${escapeHtml(videoInfo.webpage_url_domain)}</span>`);
    }
    if (videoInfo.view_count) {
        meta.push(`<span class="meta-item">${formatNumber(videoInfo.view_count)} views</span>`);
    }
    if (videoInfo.like_count) {
        meta.push(`<span class="meta-item">👍 ${formatNumber(videoInfo.like_count)}</span>`);
    }
    if (videoInfo.upload_date) {
        meta.push(`<span class="meta-item">${formatDate(videoInfo.upload_date)}</span>`);
    }
    $vMeta.innerHTML = meta.join('<span class="meta-sep">·</span>');

    const videoPresets = presets.filter((p) => p.type === 'video');
    const audioPresets = presets.filter((p) => p.type === 'audio');

    $vidFmts.innerHTML = videoPresets.map((p) => formatOptionHTML(p, '🎬')).join('');
    $audFmts.innerHTML = audioPresets.map((p) => formatOptionHTML(p, '♫')).join('');

    $card.querySelectorAll('.format-option').forEach((el) => {
        el.addEventListener('click', () => selectFormat(el.dataset.id));
    });

    if (videoPresets.length > 0) {
        selectFormat(videoPresets[0].id);
    } else if (audioPresets.length > 0) {
        selectFormat(audioPresets[0].id);
    }

    $dlBtn.disabled = false;
    $dlBtn.className = 'btn-download';
    $dlBtn.textContent = 'Add to Queue';

    $card.classList.add('visible');
}

function formatNumber(n) {
    if (!n && n !== 0) return '';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
}

function formatDate(yyyymmdd) {
    if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd || '';
    try {
        const y = parseInt(yyyymmdd.slice(0, 4));
        const m = parseInt(yyyymmdd.slice(4, 6)) - 1;
        const d = parseInt(yyyymmdd.slice(6, 8));
        return new Date(y, m, d).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    } catch {
        return yyyymmdd;
    }
}

function formatOptionHTML(p, icon) {
    const tag = p.tag ? `<span class="tag">${escapeHtml(p.tag)}</span>` : '';
    const size = p.size ? escapeHtml(p.size) : '';
    const label = p.type === 'audio' ? `${escapeHtml(p.label)} · ${escapeHtml(p.tag || '')}` : `${escapeHtml(p.label)} ${tag}`;
    return `
        <div class="format-option" data-id="${escapeHtml(p.id)}">
            <div class="format-radio"></div>
            <div class="format-icon">${icon}</div>
            <div class="format-label">${label}</div>
            <div class="format-size">${size}</div>
        </div>`;
}

function selectFormat(id) {
    selectedPreset = presets.find((p) => p.id === id) || null;
    $card.querySelectorAll('.format-option').forEach((el) => {
        el.classList.toggle('selected', el.dataset.id === id);
    });
}

function hideCard() {
    $card.classList.remove('visible');
    if (!isPlaylistMode) $empty.style.display = 'block';
}

async function doDownload() {
    if (!videoInfo || !selectedPreset) return;

    $dlBtn.disabled = true;
    $dlBtn.textContent = 'Adding...';

    const isAudio = selectedPreset.type === 'audio';

    try {
        await window.api.queueAdd([
            {
                url: videoInfo.webpage_url,
                title: videoInfo.title,
                thumbnail: videoInfo.thumbnail,
                formatId: selectedPreset.formatId,
                extractAudio: isAudio,
                audioFormat: isAudio ? 'mp3' : undefined,
            },
        ]);

        addLog(`Added to queue: ${videoInfo.title}`, 'highlight');

        // Auto-switch to queue tab on first add
        if (!hasAutoSwitchedToQueue) {
            hasAutoSwitchedToQueue = true;
            switchTab('queue');
        }

        // Reset button after brief feedback
        setTimeout(() => {
            $dlBtn.disabled = false;
            $dlBtn.className = 'btn-download';
            $dlBtn.textContent = 'Add to Queue';
        }, 1500);
    } catch (err) {
        showError(err.message || 'Failed to add to queue');
        addLog('Queue error: ' + (err.message || 'Unknown'), 'error');
        $dlBtn.disabled = false;
        $dlBtn.textContent = 'Add to Queue';
    }
}

function showPlaylist() {
    $empty.style.display = 'none';
    $card.classList.remove('visible');
    $plCard.classList.add('visible');
    $('plFooter').style.display = 'none'; // hidden until fetch completes
}

function showPlaylistFooter() {
    $('plFooter').style.display = '';
}

function hidePlaylist() {
    $plCard.classList.remove('visible');
    $('plFooter').style.display = 'none';
    playlistItems = [];
    playlistSelected = new Set();
    isPlaylistMode = false;
}

function appendPlaylistItem(item) {
    const el = document.createElement('div');
    el.className = 'pl-item';
    el.dataset.id = item.id;

    const checked = playlistSelected.has(item.id) ? 'checked' : '';
    const duration = item.duration_string || '';
    const title = escapeHtml(item.title || 'Untitled');
    const idx = item._playlist_index || playlistItems.length;

    el.innerHTML = `
        <label class="pl-item-check">
            <input type="checkbox" ${checked} onchange="togglePlaylistItem('${escapeHtml(item.id)}', this.checked)" />
            <span class="pl-check-box"></span>
        </label>
        <span class="pl-item-idx">${idx}</span>
        <div class="pl-item-info">
            <div class="pl-item-title">${title}</div>
            <div class="pl-item-meta">${duration}</div>
        </div>
    `;
    $plItems.appendChild(el);
}

function togglePlaylistItem(id, checked) {
    if (checked) playlistSelected.add(id);
    else playlistSelected.delete(id);
    updatePlDownloadBtn();
}

function playlistSelectAll() {
    playlistItems.forEach((item) => playlistSelected.add(item.id));
    $plItems.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = true));
    updatePlDownloadBtn();
}

function playlistDeselectAll() {
    playlistSelected.clear();
    $plItems.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = false));
    updatePlDownloadBtn();
}

function updatePlDownloadBtn() {
    const count = playlistSelected.size;
    $plDownloadBtn.textContent = count > 0 ? `Add ${count} item${count !== 1 ? 's' : ''} to Queue` : 'Select items to download';
    $plDownloadBtn.disabled = count === 0;
}

async function doPlaylistDownload() {
    if (playlistSelected.size === 0) return;

    const selected = playlistItems.filter((item) => playlistSelected.has(item.id));
    const opt = $plFormatSelect.options[$plFormatSelect.selectedIndex];
    const formatId = opt.value;
    const isAudio = opt.dataset.audio === 'true';

    $plDownloadBtn.disabled = true;
    $plDownloadBtn.textContent = 'Adding to queue...';

    try {
        const queueItems = selected.map((item) => ({
            url: item.webpage_url || item.url,
            title: item.title,
            thumbnail: item.thumbnail,
            formatId: formatId,
            extractAudio: isAudio,
            audioFormat: isAudio ? 'mp3' : undefined,
        }));

        await window.api.queueAdd(queueItems);
        addLog(`Added ${queueItems.length} items to queue`, 'success');

        if (!hasAutoSwitchedToQueue) {
            hasAutoSwitchedToQueue = true;
            switchTab('queue');
        }
    } catch (err) {
        showError(err.message || 'Failed to add to queue');
        addLog('Queue error: ' + (err.message || 'Unknown'), 'error');
    } finally {
        $plDownloadBtn.disabled = false;
        updatePlDownloadBtn();
    }
}

// Queue (own tab)
function updateQueueCount() {
    const { counts } = queueData;
    const active = counts.downloading + counts.pending;
    if (active > 0) {
        $queueCount.textContent = active;
        $queueCount.style.display = 'inline-block';
    } else {
        $queueCount.style.display = 'none';
    }
}

function renderQueue() {
    const { items, counts, isActive } = queueData;

    if (items.length === 0) {
        $queueToolbar.style.display = 'none';
        $queueItems.innerHTML = '';
        $queueEmpty.style.display = 'block';
        return;
    }

    $queueEmpty.style.display = 'none';
    $queueToolbar.style.display = 'flex';

    // Status text
    const statusParts = [];
    if (counts.downloading > 0) {
        statusParts.push(`${counts.downloading} downloading`);
    }
    if (counts.pending > 0) statusParts.push(`${counts.pending} waiting`);
    if (counts.completed > 0) statusParts.push(`${counts.completed} done`);
    if (counts.failed > 0) statusParts.push(`${counts.failed} failed`);
    $queueStatus.textContent = statusParts.join(' · ') || '0 items';

    // Show/hide action buttons
    $qCancelAllBtn.style.display = isActive ? 'inline-block' : 'none';
    $qRetryFailedBtn.style.display = counts.failed > 0 ? 'inline-block' : 'none';
    $qClearDoneBtn.style.display = counts.completed > 0 || (counts.failed > 0 && !isActive) ? 'inline-block' : 'none';

    // Render items
    $queueItems.innerHTML = items.map((item) => queueItemHTML(item)).join('');
    attachQueueListeners();
}

function queueItemHTML(item) {
    const stateClass = `q-state-${item.state}`;
    const title = escapeHtml(item.title || 'Untitled');

    let statusHTML = '';
    let actionsHTML = '';
    let progressHTML = '';

    if (item.state === 'pending') {
        statusHTML = '<span class="q-item-status waiting">Waiting...</span>';
        actionsHTML = `<button class="q-item-remove" data-id="${item.id}" title="Remove">×</button>`;
    } else if (item.state === 'downloading') {
        const pct = item.progress?.percent || '0%';
        const speed = item.progress?.speed || '';
        const eta = item.progress?.eta || '';
        const pctNum = parseFloat(pct) || 0;
        const detail = [speed, eta ? 'ETA ' + eta : ''].filter(Boolean).join(' · ');

        statusHTML = `<span class="q-item-status downloading">${pct}${detail ? ' · ' + detail : ''}</span>`;
        progressHTML = `<div class="q-item-progress-track"><div class="q-item-progress-fill" style="width:${pctNum}%"></div></div>`;
        actionsHTML = `<button class="q-item-cancel" title="Skip this item">⏭</button>`;
    } else if (item.state === 'completed') {
        statusHTML = '<span class="q-item-status completed">Complete ✓</span>';
        actionsHTML = `<button class="q-item-open-folder" title="Open folder" onclick="doOpenFolder()">📂</button><button class="q-item-remove" data-id="${item.id}" title="Remove">×</button>`;
    } else if (item.state === 'failed') {
        const errText = escapeHtml(item.error || 'Failed');
        statusHTML = `<span class="q-item-status failed" title="${errText}">${errText}</span>`;
        actionsHTML = `<button class="q-item-retry" data-id="${item.id}" title="Retry">↻</button><button class="q-item-remove" data-id="${item.id}" title="Remove">×</button>`;
    }

    return `
        <div class="q-item ${stateClass}" data-id="${item.id}">
            <div class="q-item-info">
                <div class="q-item-title">${title}</div>
                ${statusHTML}
            </div>
            <div class="q-item-actions">${actionsHTML}</div>
            ${progressHTML}
        </div>`;
}

function renderQueueItem(item) {
    const el = $queueItems.querySelector(`.q-item[data-id="${item.id}"]`);
    if (!el) return;

    const newEl = document.createElement('div');
    newEl.innerHTML = queueItemHTML(item);
    const replacement = newEl.firstElementChild;
    el.replaceWith(replacement);
    attachQueueListenersOn(replacement);
}

function attachQueueListeners() {
    $queueItems.querySelectorAll('.q-item').forEach(attachQueueListenersOn);
}

function attachQueueListenersOn(el) {
    el.querySelectorAll('.q-item-retry').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            doRetryItem(parseInt(btn.dataset.id));
        });
    });
    el.querySelectorAll('.q-item-remove').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            doRemoveItem(parseInt(btn.dataset.id));
        });
    });
    el.querySelectorAll('.q-item-cancel').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            doCancelCurrent();
        });
    });
}

async function doRetryItem(id) {
    try {
        await window.api.queueRetry(id);
    } catch (e) {
        addLog('Retry failed: ' + e.message, 'error');
    }
}

async function doRemoveItem(id) {
    try {
        await window.api.queueRemove(id);
    } catch (e) {
        addLog('Remove failed: ' + e.message, 'error');
    }
}

async function doCancelCurrent() {
    try {
        await window.api.queueCancelCurrent();
    } catch (e) {
        addLog('Cancel failed: ' + e.message, 'error');
    }
}

async function doCancelAll() {
    try {
        await window.api.queueCancelAll();
        addLog('Queue cancelled', 'highlight');
    } catch (e) {
        addLog('Cancel all failed: ' + e.message, 'error');
    }
}

async function doRetryFailed() {
    try {
        await window.api.queueRetryFailed();
        addLog('Retrying failed items...', 'highlight');
    } catch (e) {
        addLog('Retry failed: ' + e.message, 'error');
    }
}

async function doClearCompleted() {
    try {
        await window.api.queueClearCompleted();
        addLog('Cleared completed items');
    } catch (e) {
        addLog('Clear failed: ' + e.message, 'error');
    }
}

function showError(msg) {
    $error.innerHTML = '';
    $error.textContent = msg;
    $error.classList.add('visible');
    $error.classList.remove('auth-error');
}

function showAuthError() {
    const text = isSignedIn ? 'This video requires sign-in. Your session may have expired. ' : 'This video requires sign-in. ';
    const btnLabel = isSignedIn ? 'Sign in again' : 'Sign in to YouTube';
    $error.innerHTML = escapeHtml(text) + `<button class="auth-error-btn" onclick="doLogin()">${btnLabel}</button>`;
    $error.classList.add('visible', 'auth-error');
}

function hideError() {
    $error.classList.remove('visible', 'auth-error');
    $error.innerHTML = '';
}

function isAuthError(msg) {
    if (!msg) return false;
    // Auth errors only make sense for YouTube
    const url = ($url.value || '').toLowerCase();
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
    if (!isYouTube) return false;

    const m = msg.toLowerCase();
    return (
        m.includes('sign in to confirm your age') ||
        m.includes('private video') ||
        m.includes("this video is available to this channel's members") ||
        m.includes('this playlist is private') ||
        m.includes('join this channel') ||
        m.includes('http error 403')
    );
}

async function doLogin() {
    hideError();
    addLog('Opening YouTube sign-in...', 'highlight');
    try {
        const success = await window.api.login();
        isSignedIn = success;
        updateAuthUI();
        if (success) {
            addLog('Signed in to YouTube ✓', 'success');
        }
    } catch (e) {
        addLog('Sign-in failed: ' + e.message, 'error');
    }
}

async function doLogout() {
    try {
        await window.api.logout();
        isSignedIn = false;
        updateAuthUI();
        addLog('Signed out of YouTube');
    } catch (e) {
        addLog('Sign-out failed: ' + e.message, 'error');
    }
}

function updateAuthUI() {
    const el = $('authStatus');
    if (!el) return;
    if (isSignedIn) {
        el.innerHTML = '<span class="auth-signed-in">Signed in to YouTube</span>';
        $('authActionBtn').textContent = 'Sign out';
        $('authActionBtn').onclick = doLogout;
    } else {
        el.innerHTML = '<span class="auth-signed-out">Not signed in</span>';
        $('authActionBtn').textContent = 'Sign in';
        $('authActionBtn').onclick = doLogin;
    }
}

async function doOpenFolder() {
    window.api.openFolder();
}

async function doChooseFolder() {
    try {
        const newPath = await window.api.chooseDownloadPath();
        $('settingsPath').textContent = newPath;
        addLog('Download folder changed: ' + newPath, 'success');
    } catch (e) {
        addLog('Failed to change folder: ' + e.message, 'error');
    }
}

function openExternal(url) {
    window.api.openExternal(url);
}

async function loadHistory() {
    try {
        historyCache = await window.api.getHistory();
    } catch (e) {
        addLog('History load error: ' + e.message, 'error');
        historyCache = [];
    }
    renderHistory();
}

function renderHistory() {
    const list = historyCache;
    updateHistoryCount();

    if (list.length === 0) {
        $historyToolbar.style.display = 'none';
        $historyList.innerHTML = '';
        $historyEmpty.style.display = 'block';
        return;
    }

    $historyEmpty.style.display = 'none';
    $historyToolbar.style.display = 'flex';
    $historyCountLabel.textContent = `${list.length} item${list.length !== 1 ? 's' : ''}`;

    $historyList.innerHTML = list
        .map((entry, idx) => {
            const info = entry.info || {};
            const ago = timeAgo(entry.fetchedAt);
            const source = info.extractor_key || '';
            const uploader = info.uploader || info.channel || '';
            const thumb = info.thumbnail || '';
            const title = info.title || 'Untitled';
            const id = info.id || '';
            const ext = info.extractor_key || '';
            const duration = info.duration_string || '';

            const subParts = [];
            if (source) {
                subParts.push(`<span class="source-badge">${escapeHtml(source)}</span>`);
            }
            if (uploader) subParts.push(escapeHtml(uploader));
            if (duration) subParts.push(duration);
            subParts.push(ago);

            return `
            <div class="history-item" data-idx="${idx}">
                ${
                    thumb
                        ? `<img class="history-thumb" src="${escapeHtml(
                              thumb,
                          )}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="history-thumb-error">🎬</div>`
                        : `<div class="history-thumb-error" style="display:flex;">🎬</div>`
                }
                <div class="history-info">
                    <div class="history-title">${escapeHtml(title)}</div>
                    <div class="history-sub">${subParts.join(' <span class="meta-sep">·</span> ')}</div>
                </div>
                <div class="history-actions">
                    <button class="history-remove" data-id="${escapeHtml(id)}" data-ext="${escapeHtml(ext)}" title="Remove">×</button>
                </div>
            </div>`;
        })
        .join('');

    $historyList.querySelectorAll('.history-item').forEach((el) => {
        el.addEventListener('click', (e) => {
            if (e.target.closest('.history-remove')) return;
            const idx = parseInt(el.dataset.idx);
            if (historyCache[idx]) loadFromHistory(idx);
        });
    });

    $historyList.querySelectorAll('.history-remove').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeHistoryItem(btn.dataset.id, btn.dataset.ext);
        });
    });
}

function loadFromHistory(idx) {
    const entry = historyCache[idx];
    if (!entry || !entry.info) return;

    // Queue-completed items have no presets - just set the URL and let user fetch
    if (!entry.presets || entry.presets.length === 0) {
        $url.value = entry.info.webpage_url || '';
        hideError();
        hidePlaylist();
        hideCard();
        $empty.style.display = 'block';
        switchTab('download');
        addLog('URL loaded from history - click Fetch to get video info', 'highlight');
        return;
    }

    addLog('Loaded from history: ' + entry.info.title, 'highlight');

    videoInfo = entry.info;
    presets = entry.presets;
    selectedPreset = null;
    isPlaylistMode = false;

    $url.value = videoInfo.webpage_url || '';
    hideError();
    hidePlaylist();
    switchTab('download');
    showCard();
    showClearBtn();
}

async function removeHistoryItem(videoId, extractorKey) {
    try {
        historyCache = await window.api.removeHistory(videoId, extractorKey);
        renderHistory();
        addLog('Removed from history');
    } catch (e) {
        addLog('Failed to remove: ' + e.message, 'error');
    }
}

async function doClearHistory() {
    try {
        historyCache = await window.api.clearHistory();
        renderHistory();
        addLog('History cleared');
    } catch (e) {
        addLog('Failed to clear history: ' + e.message, 'error');
    }
}

function updateHistoryCount() {
    const count = historyCache.length;
    if (count > 0) {
        $historyCount.textContent = count;
        $historyCount.style.display = 'inline-block';
    } else {
        $historyCount.style.display = 'none';
    }
}

function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days < 7) return days + 'd ago';
    if (days < 30) return Math.floor(days / 7) + 'w ago';
    return Math.floor(days / 30) + 'mo ago';
}

async function loadSettings() {
    try {
        const dlPath = await window.api.getDownloadPath();
        $('settingsPath').textContent = dlPath || '-';
    } catch {}

    try {
        const deps = await window.api.checkDeps();

        const ytdlpEl = $('depYtdlpPath');
        const ytdlpDot = document.querySelector('#depYtdlpStatus .dep-dot');
        ytdlpEl.textContent = deps.ytdlp.found ? deps.ytdlp.path : 'Not found - run npm install';
        ytdlpDot.className = 'dep-dot ' + (deps.ytdlp.found ? 'ok' : 'missing');

        const ffEl = $('depFfmpegPath');
        const ffDot = document.querySelector('#depFfmpegStatus .dep-dot');
        ffEl.textContent = deps.ffmpeg.found ? deps.ffmpeg.path : 'Not found - run npm install';
        ffDot.className = 'dep-dot ' + (deps.ffmpeg.found ? 'ok' : 'missing');
    } catch {}

    try {
        isSignedIn = await window.api.checkAuth();
        updateAuthUI();
    } catch {}
}

async function loadAbout() {
    try {
        const info = await window.api.getAppInfo();
        $('aboutVersion').textContent = `v${info.version} · ${info.platform}/${info.arch}${info.devMode ? ' · dev' : ''}`;
    } catch {}

    // Show update status if already known
    renderAboutUpdate();
}

function showUpdateBanner() {
    if (!updateInfo || !updateInfo.hasUpdate) return;

    const banner = $('updateBanner');
    if (!banner) return;

    banner.innerHTML =
        `<span>A new version is available: <strong>v${escapeHtml(updateInfo.latest)}</strong></span>` +
        `<button class="btn-sm" onclick="openExternal('${escapeHtml(updateInfo.url)}')">Download</button>` +
        `<button class="update-dismiss" onclick="dismissUpdateBanner()" title="Dismiss">×</button>`;
    banner.classList.add('visible');
}

function dismissUpdateBanner() {
    const banner = $('updateBanner');
    if (banner) banner.classList.remove('visible');
}

function renderAboutUpdate() {
    const el = $('aboutUpdateStatus');
    if (!el) return;

    if (updateInfo && updateInfo.hasUpdate) {
        el.innerHTML =
            `<div class="about-update-available">` +
            `<span>v${escapeHtml(updateInfo.latest)} is available</span>` +
            `<a href="#" onclick="openExternal('${escapeHtml(updateInfo.url)}'); return false;">View release</a>` +
            `</div>`;
    } else if (updateInfo && !updateInfo.hasUpdate && !updateInfo.error) {
        el.textContent = "You're on the latest version";
    } else {
        el.textContent = '';
    }
}

async function doCheckForUpdates() {
    const btn = $('checkUpdateBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Checking...';
    }

    try {
        const result = await window.api.checkForUpdates();
        updateInfo = result;
        renderAboutUpdate();

        if (result.hasUpdate) {
            addLog(`Update available: v${result.latest}`, 'highlight');
            showUpdateBanner();
        } else if (result.error) {
            addLog('Update check failed: ' + result.error, 'error');
        } else {
            addLog("You're on the latest version ✓", 'success');
        }
    } catch (e) {
        addLog('Update check failed: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Check for updates';
        }
    }
}

async function init() {
    addLog('App starting...');

    try {
        const info = await window.api.getAppInfo();
        addLog(`v${info.version} · ${info.platform}/${info.arch} · dev:${info.devMode}`);
    } catch {}

    try {
        const deps = await window.api.checkDeps();
        addLog(`yt-dlp: ${deps.ytdlp.found ? '✓' : '✗ NOT FOUND'}`, deps.ytdlp.found ? 'success' : 'error');
        addLog(`ffmpeg: ${deps.ffmpeg.found ? '✓' : '✗ NOT FOUND'}`, deps.ffmpeg.found ? 'success' : 'error');

        const missing = [];
        if (!deps.ytdlp.found) missing.push('yt-dlp');
        if (!deps.ffmpeg.found) missing.push('ffmpeg');

        if (missing.length > 0) {
            const banner = $('depBanner');
            banner.textContent = `⚠ Missing: ${missing.join(', ')}. Run npm install to download them.`;
            banner.classList.add('visible');
        }
    } catch (e) {
        addLog('Dep check error: ' + e.message, 'error');
    }

    addLog('Ready');

    try {
        historyCache = await window.api.getHistory();
        updateHistoryCount();
    } catch {}

    try {
        isSignedIn = await window.api.checkAuth();
        if (isSignedIn) addLog('YouTube: signed in ✓', 'success');
        updateAuthUI();
    } catch {}
}

init();
