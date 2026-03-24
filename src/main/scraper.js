// Instagram Collection Scraper
// Opens a saved-collection URL in a hidden BrowserWindow and scrolls to load all items and returns individual post URLs.

const { BrowserWindow } = require('electron');
const { log, logError } = require('./utils');

const PARTITION = 'persist:instagram-login';

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

        let resolved = false;
        const items = [];
        const seen = new Set();

        function done() {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            if (!win.isDestroyed()) win.close();
            _log(`Scraping complete: ${items.length} post${items.length !== 1 ? 's' : ''} found`);
            resolve({ items });
        }

        function fail(err) {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            if (!win.isDestroyed()) win.close();
            reject(err);
        }

        // Increased timeout to 4 mins
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

            // Testing small delay for content to load
            setTimeout(() => scrollAndCollect(), 2500);
        });

        // Detect login redirect
        win.webContents.on('did-navigate', (_e, navUrl) => {
            if (navUrl.includes('/accounts/login')) {
                fail(new Error('Instagram login required. Sign in via Settings first.'));
            }
        });

        win.on('closed', () => {
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
            const MAX_SCROLLS = 300; // Not scroll past this

            for (let i = 0; i < MAX_SCROLLS; i++) {
                if (resolved) return;

                try {
                    // Collect links from the current page state
                    const links = await win.webContents.executeJavaScript(`
                        (() => {
                            const results = [];
                            const anchors = document.querySelectorAll('a[href]');
                            for (const a of anchors) {
                                const h = a.getAttribute('href');
                                if (h && (/^\\/p\\/[\\w-]+/.test(h) || /^\\/reel\\/[\\w-]+/.test(h))) {
                                    results.push(new URL(h, window.location.origin).href);
                                }
                            }
                            return results;
                        })()
                    `);

                    // Process new links
                    let newCount = 0;
                    for (const link of links) {
                        if (seen.has(link)) continue;
                        seen.add(link);
                        newCount++;

                        const shortcode = extractShortcode(link);
                        const item = {
                            id: shortcode,
                            title: `Post ${items.length + 1}`,
                            url: link,
                            webpage_url: link,
                            duration: null,
                            duration_string: null,
                            thumbnail: null,
                            uploader: '',
                            extractor_key: 'Instagram',
                            _playlist_index: items.length + 1,
                        };
                        items.push(item);
                        if (onItem) onItem(item, items.length);
                    }

                    if (newCount > 0) {
                        stableRounds = 0;
                        _log(`Found ${items.length} posts so far...`);
                    } else {
                        stableRounds++;
                    }

                    // End detection: no new posts for several rounds
                    if (stableRounds >= MAX_STABLE) {
                        log('Scraper: no new posts after', MAX_STABLE, 'scrolls, finishing');
                        break;
                    }

                    // Scroll down
                    await win.webContents.executeJavaScript(`
                        window.scrollTo(0, document.body.scrollHeight);
                    `);

                    // Wait for new content to load. TEST worst case
                    await delay(1500);
                } catch (err) {
                    // Window was closed?
                    if (!resolved) {
                        logError('Scraper scroll error:', err.message);
                    }
                    break;
                }
            }

            // Done scrolling
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

// Check if a URL is like an Instagram saved collection.
function isInstagramCollection(url) {
    if (!url) return false;
    try {
        const u = new URL(url);
        if (!u.hostname.includes('instagram.com')) return false;
        // /username/saved/ or /username/saved/collection_name/id/
        return u.pathname.includes('/saved/');
    } catch {
        return false;
    }
}

module.exports = { scrapeCollection, isInstagramCollection };
