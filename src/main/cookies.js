// Cookie Authentication
// Login windows, cookie extraction, Netscape cookie files for yt-dlp.
// Added support for Instagram session.

const { BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { log, logError } = require('./utils');

// Youtube

const YT_PARTITION = 'persist:youtube-login';
const YT_LOGIN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/';

let ytCookiePath = null;

function getYtCookiePath() {
    if (!ytCookiePath) {
        ytCookiePath = path.join(os.tmpdir(), 'arcdlp-cookies.txt');
    }
    return ytCookiePath;
}

async function hasCookies() {
    const ses = session.fromPartition(YT_PARTITION);
    const cookies = await ses.cookies.get({ domain: '.youtube.com' });
    return cookies.length > 0;
}

async function getCookieFile() {
    const has = await hasCookies();
    if (!has) return null;

    await writeYtCookieFile();
    const p = getYtCookiePath();
    return fs.existsSync(p) ? p : null;
}

function openLoginWindow(parentWindow) {
    return new Promise((resolve) => {
        const win = new BrowserWindow({
            width: 500,
            height: 700,
            parent: parentWindow || undefined,
            modal: !!parentWindow,
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
    const p = getYtCookiePath();
    try {
        fs.unlinkSync(p);
    } catch {
        //
    }
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
        return;
    }

    const filePath = getYtCookiePath();
    writeCookieLines(relevant, filePath);
    log('Wrote', relevant.length, 'YouTube cookies to', filePath);
}

// Instagram

const INSTA_PARTITION = 'persist:instagram-login';
const INSTA_LOGIN_URL = 'https://www.instagram.com/accounts/login/';

let instaCookiePath = null;

function getInstaCookiePath() {
    if (!instaCookiePath) {
        instaCookiePath = path.join(os.tmpdir(), 'arcdlp-insta-cookies.txt');
    }
    return instaCookiePath;
}

async function hasInstaCookies() {
    const ses = session.fromPartition(INSTA_PARTITION);
    const cookies = await ses.cookies.get({ domain: '.instagram.com' });
    // Need the sessionid cookie to be authenticated
    return cookies.some((c) => c.name === 'sessionid');
}

async function getInstaCookieFile() {
    const has = await hasInstaCookies();
    if (!has) return null;

    await writeInstaCookieFile();
    const p = getInstaCookiePath();
    return fs.existsSync(p) ? p : null;
}

function openInstaLoginWindow(parentWindow) {
    return new Promise((resolve) => {
        const win = new BrowserWindow({
            width: 500,
            height: 700,
            parent: parentWindow || undefined,
            modal: !!parentWindow,
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
    const p = getInstaCookiePath();
    try {
        fs.unlinkSync(p);
    } catch {
        //
    }
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
        return;
    }

    const filePath = getInstaCookiePath();
    writeCookieLines(relevant, filePath);
    log('Wrote', relevant.length, 'Instagram cookies to', filePath);
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

    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

module.exports = {
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
