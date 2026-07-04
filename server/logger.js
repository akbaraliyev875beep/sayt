/**
 * Logger — faylga va console'ga yozadi
 * In-memory ring buffer oxirgi 200 ta logni saqlaydi
 * Fayl 1 MB ga yetganda avtomatik rotate qiladi
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_SIZE = 1024 * 1024; // 1 MB
const MAX_FILES = 3;
const BUFFER_SIZE = 200;

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const buffer = [];

function now() {
    return new Date().toISOString();
}

function rotate() {
    try {
        if (!fs.existsSync(LOG_FILE)) return;
        if (fs.statSync(LOG_FILE).size < MAX_SIZE) return;
        for (let i = MAX_FILES - 1; i >= 1; i--) {
            const from = path.join(LOG_DIR, `app.${i}.log`);
            const to = path.join(LOG_DIR, `app.${i + 1}.log`);
            if (fs.existsSync(from)) fs.renameSync(from, to);
        }
        fs.renameSync(LOG_FILE, path.join(LOG_DIR, 'app.1.log'));
    } catch (e) {
        console.error('Log rotate error:', e.message);
    }
}

function write(level, icon, msg, meta) {
    const entry = {
        ts: now(),
        level,
        msg,
        ...(meta ? { meta } : {}),
    };

    // In-memory buffer (oxirgi N ta log)
    buffer.push(entry);
    if (buffer.length > BUFFER_SIZE) buffer.shift();

    // Faylga yozish
    try {
        rotate();
        const line = `[${entry.ts}] [${level.toUpperCase()}] ${msg}${
            meta ? ' ' + JSON.stringify(meta) : ''
        }\n`;
        fs.appendFileSync(LOG_FILE, line);
    } catch (e) {
        console.error('Log file error:', e.message);
    }

    // Console'ga yozish (Render ushlaydi)
    const out = `${icon} ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
    if (level === 'error') console.error(out);
    else if (level === 'warn') console.warn(out);
    else console.log(out);
}

module.exports = {
    info: (msg, meta) => write('info', '📝', msg, meta),
    warn: (msg, meta) => write('warn', '⚠️', msg, meta),
    error: (msg, meta) => write('error', '❌', msg, meta),
    success: (msg, meta) => write('info', '✅', msg, meta),
    event: (msg, meta) => write('info', '🔔', msg, meta),
    getRecent: (n = 50) => buffer.slice(-n),
    getStats: () => ({
        totalInBuffer: buffer.length,
        byLevel: buffer.reduce((acc, e) => {
            acc[e.level] = (acc[e.level] || 0) + 1;
            return acc;
        }, {}),
    }),
};
