// Файл для пробуждения сайта на Render (запросы каждые 5 минут)
const https = require('https');
const http = require('http');

// URL вашего сайта на Render
const APP_URL = process.env.APP_URL || 'https://fanfiction-site.onrender.com';

// URL для проверки
const urlsToCheck = [
    APP_URL,
    `${APP_URL}/health`,
    `${APP_URL}/api/fanfics`
];

function sendRequest(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const startTime = Date.now();
        
        const req = protocol.get(url, (res) => {
            const duration = Date.now() - startTime;
            const logTime = new Date().toLocaleTimeString('ru-RU');
            
            console.log(`✅ [${logTime}] ${res.statusCode} ${url} (${duration}ms)`);
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode >= 200 && res.statusCode < 400) {
                        resolve({ success: true, statusCode: res.statusCode, duration });
                    } else {
                        resolve({ success: false, statusCode: res.statusCode, duration });
                    }
                } catch (error) {
                    resolve({ success: false, statusCode: res.statusCode, error: error.message });
                }
            });
        });
        
        req.on('error', (error) => {
            const duration = Date.now() - startTime;
            const logTime = new Date().toLocaleTimeString('ru-RU');
            console.log(`❌ [${logTime}] ERROR ${url} (${duration}ms) - ${error.message}`);
            resolve({ success: false, error: error.message, duration });
        });
        
        req.setTimeout(30000, () => {
            req.destroy();
            const duration = Date.now() - startTime;
            const logTime = new Date().toLocaleTimeString('ru-RU');
            console.log(`⚠️  [${logTime}] TIMEOUT ${url} (${duration}ms)`);
            resolve({ success: false, error: 'Timeout', duration });
        });
    });
}

async function pingServer() {
    console.log(`\n🔔 [${new Date().toLocaleString('ru-RU')}] Проверяю сервер...`);
    
    let success = false;
    let attempts = 0;
    
    // Пробуем несколько URL
    for (const url of urlsToCheck) {
        attempts++;
        const result = await sendRequest(url);
        
        if (result.success) {
            success = true;
            console.log(`🎉 Сервер активен! Ответ получен за ${result.duration}ms`);
            
            // Если сервер ответил, пробуем отправить дополнительный запрос
            // чтобы "разбудить" его полностью
            if (result.duration > 2000) {
                console.log('⏳ Сервер просыпается, отправляю дополнительный запрос...');
                await new Promise(resolve => setTimeout(resolve, 1000));
                await sendRequest(`${APP_URL}/api/user`);
            }
            break;
        }
        
        // Ждем перед следующей попыткой
        if (attempts < urlsToCheck.length) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    if (!success) {
        console.log('⚠️  Не удалось получить ответ от сервера');
        console.log('💡 Совет: Проверьте правильность APP_URL в настройках');
    }
    
    return success;
}

// Если файл запущен напрямую
if (require.main === module) {
    console.log(`🚀 Keep-Alive сервис запущен`);
    console.log(`🎯 Цель: ${APP_URL}`);
    console.log(`⏰ Интервал: 5 минут\n`);
    
    async function run() {
        // Первая проверка сразу
        await pingServer();
        
        // Затем каждые 5 минут
        setInterval(async () => {
            await pingServer();
        }, 5 * 60 * 1000);
    }
    
    run().catch(console.error);
    
    // Обработка завершения
    process.on('SIGINT', () => {
        console.log(`\n🛑 Останавливаю Keep-Alive сервис...`);
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log(`\n🛑 Получен сигнал завершения...`);
        process.exit(0);
    });
}

module.exports = { pingServer };
