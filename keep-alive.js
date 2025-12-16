// Скрипт для поддержания активности сервера
const https = require('https');

function pingServer() {
    const url = process.env.RENDER_URL || 'https://your-app.onrender.com';
    
    https.get(url, (res) => {
        console.log(`Ping successful: ${res.statusCode}`);
    }).on('error', (err) => {
        console.error('Ping failed:', err.message);
    });
}

// Пинг каждые 5 минут
setInterval(pingServer, 5 * 60 * 1000);

// Первый пинг при запуске
pingServer();
