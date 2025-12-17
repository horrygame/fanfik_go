// Файл для пробуждения сайта на Render (запросы каждые 5 минут)
const https = require('https');

// URL вашего сайта на Render
const APP_URL = process.env.APP_URL || 'https://fanfik-go.onrender.com';

// URL для проверки (добавляем разные эндпоинты чтобы точно разбудить)
const urlsToCheck = [
    APP_URL,
    `${APP_URL}/api/fanfics`,
    `${APP_URL}/api/user`
];

function sendRequest(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                console.log(`✅ [${new Date().toLocaleTimeString('ru-RU')}] Запрос успешен: ${url}`);
                console.log(`   Статус: ${res.statusCode} ${res.statusMessage}`);
                resolve({ statusCode: res.statusCode, data: data });
            });
        });
        
        req.on('error', (error) => {
            console.error(`❌ [${new Date().toLocaleTimeString('ru-RU')}] Ошибка запроса: ${url}`);
            console.error(`   Ошибка: ${error.message}`);
            reject(error);
        });
        
        // Таймаут запроса (10 секунд)
        req.setTimeout(10000, () => {
            req.destroy();
            console.log(`⚠️  [${new Date().toLocaleTimeString('ru-RU')}] Таймаут запроса: ${url}`);
            reject(new Error('Timeout'));
        });
    });
}

async function keepAlive() {
    console.log(`\n🔔 [${new Date().toLocaleString('ru-RU')}] Начинаю проверку сервера...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    try {
        // Пробуем отправить запросы ко всем URL
        for (const url of urlsToCheck) {
            try {
                await sendRequest(url);
                successCount++;
                
                // Если первый запрос успешен, не проверяем остальные URL
                if (successCount > 0 && url === urlsToCheck[0]) {
                    console.log(`✨ Первый запрос успешен, пропускаю остальные проверки`);
                    break;
                }
            } catch (error) {
                errorCount++;
                
                // Если первая проверка упала, пробуем следующий URL
                if (errorCount < urlsToCheck.length) {
                    console.log(`🔄 Пробую следующий URL...`);
                    continue;
                }
            }
        }
        
        // Статистика
        console.log(`📊 Итог: Успешно: ${successCount}, Ошибок: ${errorCount}`);
        
        if (successCount > 0) {
            console.log(`🎉 Сервер активен! Следующая проверка через 5 минут\n`);
        } else {
            console.log(`⚠️  Все проверки провалились. Возможно, сервер спит или недоступен\n`);
        }
        
    } catch (error) {
        console.error(`💥 Критическая ошибка в keepAlive:`, error.message);
    }
}

// Функция для отправки тестового запроса (можно вызвать вручную)
async function testConnection() {
    console.log(`🔧 Тестирование подключения к серверу...`);
    await keepAlive();
}

// Если файл запущен напрямую
if (require.main === module) {
    console.log(`🚀 Запускаю сервис keep-alive для: ${APP_URL}`);
    console.log(`⏰ Запросы будут отправляться каждые 5 минут\n`);
    
    // Сразу делаем первый запрос
    keepAlive();
    
    // Затем каждые 5 минут (300000 миллисекунд)
    setInterval(keepAlive, 5 * 60 * 1000);
    
    // Обработка завершения
    process.on('SIGINT', () => {
        console.log(`\n🛑 Останавливаю сервис keep-alive...`);
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log(`\n🛑 Получен сигнал завершения...`);
        process.exit(0);
    });
}

module.exports = { keepAlive, testConnection };
