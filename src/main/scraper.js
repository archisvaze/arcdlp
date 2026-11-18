// yt-dlp can't list Instagram saved collections, so this opens the collection in a hidden
// window with the user's Instagram session, scrolls it and collects the post links.

const { BrowserWindow } = require('electron');
const { log, logError } = require('./utils');

const PARTITION = 'persist:instagram-login';

let activeWin = null;

// Stops a running scrape, posts found so far are kept
function cancelScrape() {
    if (activeWin && !activeWin.isDestroyed()) activeWin.close();
}

function scrapeCollection(url, parent, { onLog, onItem } = {}) {
    const _log = (msg) => {
        log('Scraper:', msg);
        if (onLog) onLog(msg);
    };

    return new Promise((resolve, reject) => {
        const win = new BrowserWindow({
            width: 800,
            height: 900,
            show: false,
            parent: parent || undefined,
            webPreferences: {
                partition: PARTITION,
                nodeIntegration: false,
                contextIsolation: true,
            },
            autoHideMenuBar: true,
        });
        activeWin = win;

        let resolved = false;
        const items = [];
        const seen = new Set();

        function done() {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            if (!win.isDestroyed()) win.close();
            _log(`Scraping complete: ${items.length} video${items.length !== 1 ? 's' : ''} found`);
            resolve({ items });
        }

        function fail(err) {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            if (!win.isDestroyed()) win.close();
            reject(err);
        }

        // 4 minute limit, posts found by then are kept
        const timer = setTimeout(() => {
            if (items.length > 0) {
                _log(`Scraping timed out after ${items.length} posts`);
                done();
            } else {
                fail(new Error('Timeout. No posts found'));
            }
        }, 240000);

        win.webContents.on('did-finish-load', () => {
            _log('Page loaded, scanning for posts...');

            // Let the grid render before the first scan
            setTimeout(() => scrollAndCollect(), 2500);
        });

        // A missing or expired session redirects to the login page
        win.webContents.on('did-navigate', (_e, navUrl) => {
            if (navUrl.includes('/accounts/login')) {
                fail(new Error('Instagram login required. Sign in via Settings first.'));
            }
        });

        win.on('closed', () => {
            if (activeWin === win) activeWin = null;
            clearTimeout(timer);
            if (!resolved) {
                if (items.length > 0) {
                    done();
                } else {
                    fail(new Error('Scraping cancelled'));
                }
            }
        });

        async function scrollAndCollect() {
            if (resolved) return;

            let stableRounds = 0;
            const MAX_STABLE = 5;
            const MAX_SCROLLS = 300;

            for (let i = 0; i < MAX_SCROLLS; i++) {
                if (resolved) return;

                try {
                    // Collect post links with thumbnails from the current page
                    const links = await win.webContents.executeJavaScript(`
                        (() => {
                            const results = [];
                            const anchors = document.querySelectorAll('a[href]');
                            for (const a of anchors) {
                                const h = a.getAttribute('href');
                                if (h && (/^\\/p\\/[\\w-]+/.test(h) || /^\\/reel\\/[\\w-]+/.test(h))) {
                                    const img = a.querySelector('img');
                                    results.push({
                                        url: new URL(h, window.location.origin).href,
                                        thumbnail: img ? img.src : null,
                                        alt: img ? (img.alt || '') : '',
                                    });
                                }
                            }
                            return results;
                        })()
                    `);

                    // Photos count as new content too, so a stretch of photo posts doesn't end the scroll early
                    let newCount = 0;
                    for (const entry of links) {
                        if (seen.has(entry.url)) continue;
                        seen.add(entry.url);
                        newCount++;

                        // Skip photo posts. Instagram auto-generates alt text starting with
                        // "Photo by" for image posts. Videos use the caption instead.
                        // If a photo slips through, yt-dlp will fail gracefully and the
                        // queue moves on to the next item.
                        if (entry.alt.startsWith('Photo by ')) continue;

                        const shortcode = extractShortcode(entry.url);

                        // Use alt text as title, truncate long captions, fall back to generic
                        let title = entry.alt ? entry.alt.split('\n')[0].trim() : '';
                        if (title.length > 80) title = title.slice(0, 77) + '...';
                        if (!title) title = `Post ${items.length + 1}`;

                        const item = {
                            id: shortcode,
                            title,
                            url: entry.url,
                            webpage_url: entry.url,
                            duration: null,
                            duration_string: null,
                            thumbnail: entry.thumbnail || null,
                            uploader: '',
                            extractor_key: 'Instagram',
                            _playlist_index: items.length + 1,
                        };
                        items.push(item);
                        if (onItem) onItem(item, items.length);
                    }

                    if (newCount > 0) {
                        stableRounds = 0;
                        _log(`Found ${items.length} video${items.length !== 1 ? 's' : ''} so far...`);
                    } else {
                        stableRounds++;
                    }

                    // Reached the end once several scrolls in a row load nothing new
                    if (stableRounds >= MAX_STABLE) {
                        log('Scraper: no new posts after', MAX_STABLE, 'scrolls, finishing');
                        break;
                    }

                    await win.webContents.executeJavaScript(`
                        window.scrollTo(0, document.body.scrollHeight);
                    `);

                    // Give Instagram time to load the next batch
                    await delay(1500);
                } catch (err) {
                    // Usually the window was closed by Stop or the timeout
                    if (!resolved) {
                        logError('Scraper scroll error:', err.message);
                    }
                    break;
                }
            }

            if (!resolved) done();
        }

        _log('Opening collection page...');
        win.loadURL(url);
    });
}

function extractShortcode(url) {
    const match = url.match(/\/(p|reel)\/([\w-]+)/);
    return match ? match[2] : url;
}

function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function isInstagramCollection(url) {
    if (!url) return false;
    try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol) || !/(^|\.)instagram\.com$/.test(u.hostname)) return false;
        // /username/saved/ or /username/saved/collection_name/id/
        return u.pathname.includes('/saved/');
    } catch {
        return false;
    }
}

module.exports = { scrapeCollection, isInstagramCollection, cancelScrape };
