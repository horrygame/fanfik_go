const https = require('https');

// URL вашего приложения на Render
const url = process.env.APP_URL || 'https://fanfik-go.onrender.com';

function keepAlive() {
    https.get(url, (res) => {
        console.log(`Keep-alive запрос отправлен. Статус: ${res.statusCode} - ${new Date().toISOString()}`);
    }).on('error', (err) => {
        console.error('Ошибка keep-alive запроса:', err.message);
    });
}

// Отправлять запрос каждые 5 минут
setInterval(keepAlive, 5 * 60 * 1000);

// Первый запрос при запуске
keepAlive();

console.log('Сервис keep-alive запущен. Запросы каждые 5 минут.');
