#!/usr/bin/env node
/**
 * Усовершенствованная система поддержания активности сайта на Render
 * Отправляет пинг каждые 13 минут 30 секунд (для 15-минутного таймаута)
 */

const https = require('https');
const http = require('http');

class KeepAlive {
    constructor() {
        // Получаем URL из переменных окружения
        this.urls = this.getUrls();
        
        // Интервал 13 минут 30 секунд (810000 мс)
        // Это безопасный интервал для 15-минутного таймаута Render
        this.interval = 13 * 60 * 1000 + 30 * 1000; 
        
        // Минимальный интервал между запросами (чтобы избежать спама)
        this.minDelay = 5000; // 5 секунд
        
        // Статистика
        this.stats = {
            successfulPings: 0,
            failedPings: 0,
            lastSuccess: null,
            lastError: null
        };
        
        this.init();
    }
    
    getUrls() {
        // Основные URL из переменных окружения
        const urls = [
            process.env.RENDER_URL,
            process.env.APP_URL,
            process.env.WEB_URL
        ].filter(url => url && url.startsWith('http'));
        
        // Если URL нет в переменных окружения, используем localhost для тестов
        if (urls.length === 0) {
            console.warn('⚠️ URL не найдены в переменных окружения, использую localhost для тестов');
            return ['http://localhost:3000'];
        }
        
        return urls;
    }
    
    init() {
        console.log('🚀 Запуск улучшенной системы поддержания активности...');
        console.log(`📡 Отслеживаемые URL: ${this.urls.join(', ')}`);
        console.log(`⏰ Интервал пинга: ${Math.round(this.interval / 1000 / 60)} минут ${Math.round((this.interval % (60 * 1000)) / 1000)} секунд`);
        console.log(`⏱️ Таймаут Render: 15 минут`);
        console.log(`🛡️ Безопасный запас: 1.5 минуты`);
        
        // Немедленный пинг при запуске
        this.pingAll();
        
        // Пинг по расписанию
        const scheduleInterval = setInterval(() => {
            this.pingAll();
        }, this.interval);
        
        // Логирование статуса каждые 5 минут
        const statusInterval = setInterval(() => {
            this.logStatus();
        }, 5 * 60 * 1000);
        
        // Сохраняем интервалы для очистки при завершении
        this.intervals = [scheduleInterval, statusInterval];
        
        // Обработка завершения работы
        this.setupShutdownHandlers();
        
        console.log('✅ Система keep-alive запущена и работает');
    }
    
    pingAll() {
        const timestamp = new Date().toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow',
            hour12: false
        });
        
        console.log(`\n🔄 [${timestamp}] Начинаю серию пингов...`);
        
        // Последовательно пингуем все URL с задержкой между ними
        this.urls.forEach((url, index) => {
            setTimeout(() => {
                this.ping(url);
            }, index * this.minDelay);
        });
    }
    
    ping(url) {
        if (!url) return;
        
        const protocol = url.startsWith('https') ? https : http;
        const startTime = Date.now();
        
        console.log(`📡 Пингую ${url}...`);
        
        const req = protocol.get(url, (res) => {
            const responseTime = Date.now() - startTime;
            const success = res.statusCode >= 200 && res.statusCode < 400;
            
            if (success) {
                this.stats.successfulPings++;
                this.stats.lastSuccess = new Date();
                console.log(`✅ ${url} ответил: ${res.statusCode} (${responseTime}мс)`);
                
                // Проверяем размер ответа для дополнительной валидации
                let data = '';
                res.on('data', chunk => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    if (data.length > 0) {
                        console.log(`📊 Ответ содержит ~${Math.round(data.length / 1024)}KB данных`);
                    }
                });
            } else {
                this.stats.failedPings++;
                this.stats.lastError = new Date();
                console.warn(`⚠️ ${url} вернул нестандартный статус: ${res.statusCode}`);
            }
        });
        
        // Таймаут 45 секунд (больше стандартного, но безопасно для холодного старта)
        req.setTimeout(45000, () => {
            this.stats.failedPings++;
            this.stats.lastError = new Date();
            console.error(`⏰ ${url}: Таймаут (45 секунд)`);
            req.destroy();
            
            // Пробуем альтернативный протокол
            this.tryAlternativeProtocol(url);
        });
        
        req.on('error', (err) => {
            this.stats.failedPings++;
            this.stats.lastError = new Date();
            console.error(`❌ ${url}: Ошибка - ${err.message}`);
            
            // Пробуем альтернативный протокол
            this.tryAlternativeProtocol(url);
        });
        
        // Устанавливаем заголовки для имитации реального браузера
        req.setHeader('User-Agent', 'Mozilla/5.0 (Keep-Alive Bot)');
        req.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
        req.setHeader('Accept-Language', 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7');
        
        req.end();
    }
    
    tryAlternativeProtocol(url) {
        // Если URL https, пробуем http и наоборот
        let altUrl = null;
        
        if (url.startsWith('https://')) {
            altUrl = url.replace('https://', 'http://');
        } else if (url.startsWith('http://')) {
            altUrl = url.replace('http://', 'https://');
        }
        
        if (altUrl) {
            console.log(`🔄 Пробую альтернативный протокол: ${altUrl}`);
            // Задержка перед повторной попыткой
            setTimeout(() => this.ping(altUrl), 10000);
        }
    }
    
    logStatus() {
        const now = new Date();
        console.log('\n📊 === СТАТУС СИСТЕМЫ KEEP-ALIVE ===');
        console.log(`🕐 Текущее время: ${now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);
        console.log(`✅ Успешных пингов: ${this.stats.successfulPings}`);
        console.log(`❌ Неудачных пингов: ${this.stats.failedPings}`);
        console.log(`📈 Успешность: ${this.calculateSuccessRate()}%`);
        
        if (this.stats.lastSuccess) {
            const lastSuccessTime = Math.round((now - this.stats.lastSuccess) / 1000 / 60);
            console.log(`⏱️ Последний успешный пинг: ${lastSuccessTime} минут назад`);
        }
        
        if (this.stats.lastError) {
            const lastErrorTime = Math.round((now - this.stats.lastError) / 1000 / 60);
            console.log(`⚠️ Последняя ошибка: ${lastErrorTime} минут назад`);
        }
        
        console.log('====================================\n');
    }
    
    calculateSuccessRate() {
        const total = this.stats.successfulPings + this.stats.failedPings;
        if (total === 0) return 100;
        return Math.round((this.stats.successfulPings / total) * 100);
    }
    
    setupShutdownHandlers() {
        const cleanup = (signal) => {
            console.log(`\n🛑 Получен сигнал ${signal}, завершение работы...`);
            
            // Очищаем интервалы
            this.intervals.forEach(interval => clearInterval(interval));
            
            console.log('📊 Финальная статистика:');
            console.log(`   Успешных пингов: ${this.stats.successfulPings}`);
            console.log(`   Неудачных пингов: ${this.stats.failedPings}`);
            console.log(`   Общая успешность: ${this.calculateSuccessRate()}%`);
            
            console.log('👋 Завершаю работу системы keep-alive');
            process.exit(0);
        };
        
        process.on('SIGINT', () => cleanup('SIGINT'));
        process.on('SIGTERM', () => cleanup('SIGTERM'));
        process.on('SIGUSR2', () => cleanup('SIGUSR2'));
        
        // Обработка необработанных исключений
        process.on('uncaughtException', (err) => {
            console.error('💥 Необработанное исключение:', err);
            cleanup('UNCAUGHT_EXCEPTION');
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            console.error('💥 Необработанный промис:', reason);
            cleanup('UNHANDLED_REJECTION');
        });
    }
    
    // Метод для тестирования
    test() {
        console.log('🧪 Запуск тестового пинга...');
        this.pingAll();
    }
}

// Запускаем если не в режиме тестирования
if (require.main === module) {
    // Добавляем небольшую задержку перед запуском, чтобы дать основному приложению запуститься
    setTimeout(() => {
        const keepAlive = new KeepAlive();
        
        // Экспортируем для использования в других модулях
        module.exports = keepAlive;
    }, 10000); // 10 секунд задержки
} else {
    module.exports = KeepAlive;
}
