// Update Checker
// Checks GitHub Releases API for newer versions.

const { net } = require('electron');
const { log, logError } = require('./utils');

const GITHUB_OWNER = 'archisvaze';
const GITHUB_REPO = 'arcdlp';
const API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

async function checkForUpdates(currentVersion) {
    log('Checking for updates...');

    try {
        const data = await fetchJSON(API_URL);

        if (!data || !data.tag_name) {
            log('No release data found');
            return { hasUpdate: false };
        }

        const latest = data.tag_name.replace(/^v/, '');
        const current = currentVersion.replace(/^v/, '');

        const hasUpdate = isNewer(latest, current);
        log(`Current: ${current}, Latest: ${latest}, Update: ${hasUpdate}`);

        return {
            hasUpdate,
            current,
            latest,
            url: data.html_url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
            body: data.body || '',
            publishedAt: data.published_at || null,
        };
    } catch (err) {
        logError('Update check failed:', err.message);
        return { hasUpdate: false, error: err.message };
    }
}

// Handles 1.2.3, 1.2,

function isNewer(a, b) {
    const parse = (v) =>
        v
            .split('-')[0]
            .split('.')
            .map((n) => parseInt(n, 10) || 0);

    const pa = parse(a);
    const pb = parse(b);
    const len = Math.max(pa.length, pb.length);

    for (let i = 0; i < len; i++) {
        const va = pa[i] || 0;
        const vb = pb[i] || 0;
        if (va > vb) return true;
        if (va < vb) return false;
    }
    return false;
}

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        const request = net.request({
            url,
            method: 'GET',
        });

        request.setHeader('User-Agent', 'ArcDLP-Updater');
        request.setHeader('Accept', 'application/vnd.github.v3+json');

        let body = '';

        request.on('response', (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`GitHub API returned ${response.statusCode}`));
                return;
            }

            response.on('data', (chunk) => {
                body += chunk.toString();
            });

            response.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(new Error('Invalid JSON from GitHub API'));
                }
            });

            response.on('error', (err) => {
                reject(err);
            });
        });

        request.on('error', (err) => {
            reject(err);
        });

        // 10s timeout
        setTimeout(() => {
            request.abort();
            reject(new Error('Update check timed out'));
        }, 10000);

        request.end();
    });
}

module.exports = { checkForUpdates };
