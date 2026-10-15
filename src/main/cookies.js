// Cookie Authentication
// Login windows, cookie extraction, Netscape cookie files for yt-dlp.
// Added support for Instagram session.

const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { log, logError } = require('./utils');

// Cookie files for yt-dlp live in a private folder inside userData, one file per run

function getCookieDir() {
    const dir = path.join(app.getPath('userData'), 'cookie-jars');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}

function newCookiePath(prefix) {
    return path.join(getCookieDir(), `${prefix}-${crypto.randomBytes(6).toString('hex')}.txt`);
}

function removeCookieFile(p) {
    if (!p) return;
    try {
        fs.unlinkSync(p);
    } catch {
        //
    }
}

// Removes leftover cookie files, including the shared temp files older versions wrote
function purgeCookieFiles(prefix) {
    try {
        const dir = getCookieDir();
        for (const f of fs.readdirSync(dir)) {
            if (!prefix || f.startsWith(prefix + '-')) removeCookieFile(path.join(dir, f));
        }
    } catch {
        //
    }
    if (!prefix || prefix === 'yt') removeCookieFile(path.join(os.tmpdir(), 'arcdlp-cookies.txt'));
    if (!prefix || prefix === 'ig') removeCookieFile(path.join(os.tmpdir(), 'arcdlp-insta-cookies.txt'));
}

// Youtube

const YT_PARTITION = 'persist:youtube-login';
const YT_LOGIN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/';

// Cookies that only exist for a signed in Google account, anonymous visits get none of these
const YT_AUTH_COOKIES = new Set(['SID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID', '__Secure-3PAPISID', 'LOGIN_INFO']);

async function hasCookies() {
    const ses = session.fromPartition(YT_PARTITION);
    const cookies = await ses.cookies.get({});
    return cookies.some((c) => YT_AUTH_COOKIES.has(c.name) && /(^|\.)(youtube|google)\.com$/.test((c.domain || '').replace(/^\./, '')));
}

async function getCookieFile() {
    const has = await hasCookies();
    if (!has) return null;

    return writeYtCookieFile();
}

function openLoginWindow(parentWindow) {
    return new Promise((resolve) => {
        const win = new BrowserWindow({
            width: 500,
            height: 700,
            parent: parentWindow || undefined,
            title: 'Sign in to YouTube',
            webPreferences: {
                partition: YT_PARTITION,
                nodeIntegration: false,
                contextIsolation: true,
            },
            autoHideMenuBar: true,
        });

        let resolved = false;

        function done(result) {
            if (resolved) return;
            resolved = true;
            if (!win.isDestroyed()) win.close();
            resolve(result);
        }

        win.webContents.on('did-navigate', (_e, url) => {
            log('Login nav:', url);
            if (isYouTubeHome(url)) {
                log('Login detected, landed on YouTube');
                setTimeout(() => done(true), 1000);
            }
        });

        win.webContents.on('did-navigate-in-page', (_e, url) => {
            if (isYouTubeHome(url)) {
                setTimeout(() => done(true), 1000);
            }
        });

        win.on('closed', () => done(false));

        win.loadURL(YT_LOGIN_URL);
    });
}

async function clearCookies() {
    const ses = session.fromPartition(YT_PARTITION);
    await ses.clearStorageData();
    purgeCookieFiles('yt');
    log('YouTube cookies cleared');
}

function isYouTubeHome(url) {
    try {
        const u = new URL(url);
        return u.hostname === 'www.youtube.com' && (u.pathname === '/' || u.pathname.startsWith('/feed'));
    } catch {
        return false;
    }
}

async function writeYtCookieFile() {
    const ses = session.fromPartition(YT_PARTITION);
    const cookies = await ses.cookies.get({});

    const relevant = cookies.filter((c) => {
        const d = c.domain || '';
        return d.includes('youtube.com') || d.includes('google.com') || d.includes('googleapis.com');
    });

    if (relevant.length === 0) {
        log('No YouTube/Google cookies found');
        return null;
    }

    const filePath = newCookiePath('yt');
    writeCookieLines(relevant, filePath);
    log('Wrote', relevant.length, 'YouTube cookies to', filePath);
    return filePath;
}

// Instagram

const INSTA_PARTITION = 'persist:instagram-login';
const INSTA_LOGIN_URL = 'https://www.instagram.com/accounts/login/';

async function hasInstaCookies() {
    const ses = session.fromPartition(INSTA_PARTITION);
    const cookies = await ses.cookies.get({ domain: '.instagram.com' });
    // Need the sessionid cookie to be authenticated
    return cookies.some((c) => c.name === 'sessionid');
}

async function getInstaCookieFile() {
    const has = await hasInstaCookies();
    if (!has) return null;

    return writeInstaCookieFile();
}

function openInstaLoginWindow(parentWindow) {
    return new Promise((resolve) => {
        const win = new BrowserWindow({
            width: 500,
            height: 700,
            parent: parentWindow || undefined,
            title: 'Sign in to Instagram',
            webPreferences: {
                partition: INSTA_PARTITION,
                nodeIntegration: false,
                contextIsolation: true,
            },
            autoHideMenuBar: true,
        });

        let resolved = false;

        function done(result) {
            if (resolved) return;
            resolved = true;
            if (!win.isDestroyed()) win.close();
            resolve(result);
        }

        win.webContents.on('did-navigate', (_e, url) => {
            log('Instagram login nav:', url);
            if (isInstagramHome(url)) {
                log('Instagram login detected');
                setTimeout(() => done(true), 1500);
            }
        });

        win.webContents.on('did-navigate-in-page', (_e, url) => {
            if (isInstagramHome(url)) {
                setTimeout(() => done(true), 1500);
            }
        });

        win.on('closed', () => done(false));

        win.loadURL(INSTA_LOGIN_URL);
    });
}

async function clearInstaCookies() {
    const ses = session.fromPartition(INSTA_PARTITION);
    await ses.clearStorageData();
    purgeCookieFiles('ig');
    log('Instagram cookies cleared');
}

function isInstagramHome(url) {
    try {
        const u = new URL(url);
        return (
            u.hostname === 'www.instagram.com' && (u.pathname === '/' || u.pathname.startsWith('/feed') || u.pathname.startsWith('/direct'))
        );
    } catch {
        return false;
    }
}

async function writeInstaCookieFile() {
    const ses = session.fromPartition(INSTA_PARTITION);
    const cookies = await ses.cookies.get({});

    const relevant = cookies.filter((c) => {
        const d = c.domain || '';
        return d.includes('instagram.com') || d.includes('facebook.com') || d.includes('fbcdn.net');
    });

    if (relevant.length === 0) {
        log('No Instagram cookies found');
        return null;
    }

    const filePath = newCookiePath('ig');
    writeCookieLines(relevant, filePath);
    log('Wrote', relevant.length, 'Instagram cookies to', filePath);
    return filePath;
}

// Shared

function writeCookieLines(cookies, filePath) {
    const lines = ['# Netscape HTTP Cookie File', '# Generated by ArcDLP', ''];

    for (const c of cookies) {
        const domain = c.domain.startsWith('.') ? c.domain : '.' + c.domain;
        const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
        const pathVal = c.path || '/';
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
        lines.push(`${domain}\t${flag}\t${pathVal}\t${secure}\t${expiry}\t${c.name}\t${c.value}`);
    }

    fs.writeFileSync(filePath, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
}

module.exports = {
    removeCookieFile,
    purgeCookieFiles,

    // YouTube
    hasCookies,
    getCookieFile,
    openLoginWindow,
    clearCookies,

    // Instagram
    hasInstaCookies,
    getInstaCookieFile,
    openInstaLoginWindow,
    clearInstaCookies,
};
