#!/usr/bin/env node
/**
 * Скрипт для поддержания активности сайта на Render
 * Отправляет пинг каждые 4 минуты 50 секунд
 */

const https = require('https');
const http = require('http');

class KeepAlive {
    constructor() {
        this.urls = [
            process.env.RENDER_URL,
            process.env.APP_URL,
            'https://fanfik-go.onrender.com'
        ].filter(url => url && url.startsWith('http'));
        
        this.interval = 4 * 60 * 1000 + 50 * 1000; // 4 минуты 50 секунд
        this.init();
    }
    
    init() {
        console.log('🚀 Запуск системы поддержания активности...');
        console.log(`📡 Отслеживаемые URL: ${this.urls.join(', ')}`);
        console.log(`⏰ Интервал пинга: ${this.interval / 1000} секунд`);
        
        // Немедленный пинг при запуске
        this.pingAll();
        
        // Пинг по расписанию
        setInterval(() => {
            this.pingAll();
        }, this.interval);
        
        // Логирование каждые 10 минут для мониторинга
        setInterval(() => {
            const now = new Date();
            console.log(`📊 [${now.toLocaleString()}] Система keep-alive работает нормально`);
        }, 10 * 60 * 1000);
    }
    
    pingAll() {
        const timestamp = new Date().toLocaleString();
        console.log(`\n🔄 [${timestamp}] Отправка пингов...`);
        
        this.urls.forEach(url => {
            this.ping(url);
        });
    }
    
    ping(url) {
        if (!url) return;
        
        const protocol = url.startsWith('https') ? https : http;
        
        const req = protocol.get(url, (res) => {
            const success = res.statusCode >= 200 && res.statusCode < 400;
            const status = success ? '✅' : '⚠️';
            console.log(`${status} ${url} ответил: ${res.statusCode}`);
            
            // Если статус не 200-399, пишем предупреждение
            if (!success) {
                console.warn(`⚠️ ${url} вернул нестандартный статус: ${res.statusCode}`);
            }
        });
        
        req.setTimeout(30000, () => {
            console.error(`⏰ ${url}: Таймаут (30 секунд)`);
            req.destroy();
        });
        
        req.on('error', (err) => {
            console.error(`❌ ${url}: Ошибка - ${err.message}`);
            
            // Пробуем альтернативный URL
            if (url.includes('onrender.com')) {
                const altUrl = url.replace('https://', 'http://');
                console.log(`🔄 Пробуем альтернативный URL: ${altUrl}`);
                setTimeout(() => this.ping(altUrl), 5000);
            }
        });
        
        // Отправляем запрос с заголовками
        req.end();
    }
    
    // Функция для тестирования
    test() {
        console.log('🧪 Запуск тестового пинга...');
        this.pingAll();
    }
}

// Запускаем если не в режиме тестирования
if (require.main === module) {
    const keepAlive = new KeepAlive();
    
    // Обработка сигналов для graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Получен SIGINT, завершение работы...');
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log('\n🛑 Получен SIGTERM, завершение работы...');
        process.exit(0);
    });
    
    // Экспортируем для использования в других модулях
    module.exports = keepAlive;
} else {
    module.exports = KeepAlive;
}
