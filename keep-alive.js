// Скрипт для поддержания активности сервера
const https = require('https');

function pingServer() {
    const urls = [
        process.env.RENDER_URL,
        process.env.APP_URL
    ].filter(url => url);
    
    urls.forEach(url => {
        https.get(url, (res) => {
            console.log(`✅ Пинг успешен: ${url} - ${res.statusCode}`);
        }).on('error', (err) => {
            console.error(`❌ Ошибка пинга ${url}:`, err.message);
        });
    });
}

// Пинг каждые 5 минут
setInterval(pingServer, 5 * 60 * 1000);

// Первый пинг при запуске
pingServer();

module.exports = { pingServer };
