const DEV_MODE = !!(process.env.DEV_MODE || process.argv.includes('--dev') || process.argv.includes('--dev-mode'));

function log(...args) {
    if (DEV_MODE) console.log('[App]', ...args);
}

function logError(...args) {
    console.error('[Error]', ...args);
}

module.exports = { DEV_MODE, log, logError };
