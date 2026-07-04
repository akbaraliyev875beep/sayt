/**
 * Telegram notifier
 * TELEGRAM_BOT_TOKEN va TELEGRAM_CHAT_ID env orqali ishlaydi
 * Ikkalasi ham bo'lsa yoqiladi, bo'lmasa o'chirilgan
 */
const https = require('https');
const querystring = require('querystring');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ENABLED = Boolean(TOKEN && CHAT_ID);

/**
 * Xabar yuborish — muvaffaqiyatsa true, muvaffaqiyatsa false
 * Xato bo'lsa server ishlamay qolmaydi
 */
function send(text) {
    if (!ENABLED) return Promise.resolve(false);

    return new Promise((resolve) => {
        try {
            const data = querystring.stringify({
                chat_id: CHAT_ID,
                text,
                disable_web_page_preview: 'true',
            });

            const req = https.request(
                {
                    hostname: 'api.telegram.org',
                    port: 443,
                    path: `/bot${TOKEN}/sendMessage`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': Buffer.byteLength(data),
                    },
                    timeout: 5000,
                },
                (res) => {
                    res.on('data', () => {});
                    res.on('end', () => resolve(res.statusCode === 200));
                }
            );

            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });

            req.write(data);
            req.end();
        } catch (e) {
            resolve(false);
        }
    });
}

module.exports = { send, ENABLED };
