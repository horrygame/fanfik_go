#!/usr/bin/env node
/**
 * 🚀 Keep-Alive Script для FanFik Platform
 * Предотвращает засыпание сайта на Render, Heroku и других хостингах
 */

const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const fs = require('fs').promises;

class KeepAlive {
    constructor() {
        // Список URL для пинга
        this.urls = [];
        this.interval = 4.5 * 60 * 1000; // 4.5 минуты (270 секунд)
        this.logFile = 'keep-alive.log';
        this.maxLogSize = 1024 * 1024; // 1MB
        this.init();
    }
    
    async init() {
        console.log('='.repeat(60));
        console.log('🔄 ЗАПУСК СИСТЕМЫ ПОДДЕРЖАНИЯ АКТИВНОСТИ');
        console.log('='.repeat(60));
        
        await this.loadUrls();
        await this.cleanLogs();
        
        console.log(`📡 URL для мониторинга: ${this.urls.length}`);
        this.urls.forEach((url, i) => console.log(`  ${i+1}. ${url}`));
        console.log(`⏰ Интервал пинга: ${this.interval / 1000} секунд`);
        console.log(`📊 Логирование в: ${this.logFile}`);
        console.log('='.repeat(60));
        
        // Немедленный пинг при запуске
        this.pingAll();
        
        // Пинг по расписанию
        setInterval(() => {
            this.pingAll();
        }, this.interval);
        
        // Периодическая проверка состояния
        setInterval(() => {
            this.healthCheck();
        }, 10 * 60 * 1000); // Каждые 10 минут
        
        // Логирование каждые 30 минут
        setInterval(() => {
            this.logStatus();
        }, 30 * 60 * 1000);
        
        // Мониторинг использования памяти
        setInterval(() => {
            this.monitorResources();
        }, 5 * 60 * 1000);
    }
    
    async loadUrls() {
        // 1. Берем URL из переменных окружения
        const envUrls = [
            process.env.RENDER_URL,
            process.env.APP_URL,
            process.env.WEBSITE_URL,
            process.env.HEROKU_URL
        ].filter(url => url && url.startsWith('http'));
        
        // 2. Если есть DOMAIN_NAME, используем его
        if (process.env.DOMAIN_NAME) {
            const protocols = ['https://', 'http://'];
            protocols.forEach(protocol => {
                const url = `${protocol}${process.env.DOMAIN_NAME}`;
                envUrls.push(url);
            });
        }
        
        // 3. Добавляем стандартные варианты для Render
        if (process.env.RENDER_EXTERNAL_HOSTNAME) {
            envUrls.push(`https://${process.env.RENDER_EXTERNAL_HOSTNAME}`);
        }
        
        // 4. Удаляем дубликаты
        this.urls = [...new Set(envUrls)];
        
        // 5. Если нет URL, используем локальный
        if (this.urls.length === 0) {
            this.urls.push('http://localhost:3000');
            console.log('⚠️  URL не найдены, используется локальный хост');
        }
        
        // 6. Проверяем доступность URL перед добавлением
        const validUrls = [];
        for (const url of this.urls) {
            if (await this.testUrl(url)) {
                validUrls.push(url);
            }
        }
        
        this.urls = validUrls;
    }
    
    async testUrl(url) {
        return new Promise((resolve) => {
            const protocol = url.startsWith('https') ? https : http;
            const req = protocol.get(url, (res) => {
                resolve(res.statusCode < 400);
            }).on('error', () => {
                resolve(false);
            });
            
            req.setTimeout(5000, () => {
                req.destroy();
                resolve(false);
            });
        });
    }
    
    async cleanLogs() {
        try {
            const stats = await fs.stat(this.logFile).catch(() => null);
            if (stats && stats.size > this.maxLogSize) {
                await fs.writeFile(this.logFile, '');
                console.log('🧹 Лог-файл очищен (превышен размер)');
            }
        } catch (error) {
            // Файла не существует или ошибка доступа
        }
    }
    
    async log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${type}] ${message}\n`;
        
        console.log(logMessage.trim());
        
        try {
            await fs.appendFile(this.logFile, logMessage);
        } catch (error) {
            console.error('❌ Ошибка записи в лог:', error.message);
        }
    }
    
    pingAll() {
        const timestamp = new Date().toLocaleString('ru-RU');
        this.log(`Запуск пинга всех URL (${timestamp})`);
        
        this.urls.forEach(url => {
            this.ping(url);
        });
    }
    
    ping(url) {
        if (!url) return;
        
        const protocol = url.startsWith('https') ? https : http;
        const startTime = Date.now();
        
        const req = protocol.get(url, (res) => {
            const responseTime = Date.now() - startTime;
            const success = res.statusCode >= 200 && res.statusCode < 400;
            
            if (success) {
                this.log(`✅ ${url} - ${res.statusCode} (${responseTime}ms)`, 'SUCCESS');
            } else {
                this.log(`⚠️  ${url} - ${res.statusCode} (нестандартный статус)`, 'WARNING');
            }
            
            // Анализируем заголовки для диагностики
            this.analyzeHeaders(url, res.headers);
        });
        
        req.setTimeout(45000, () => {
            this.log(`⏰ ${url} - Таймаут 45 секунд`, 'TIMEOUT');
            req.destroy();
            
            // Пробуем альтернативный протокол при таймауте
            this.tryAlternativeProtocol(url);
        });
        
        req.on('error', (err) => {
            const responseTime = Date.now() - startTime;
            this.log(`❌ ${url} - ${err.code || err.message} (${responseTime}ms)`, 'ERROR');
            
            // Автоматическое восстановление
            this.autoRecovery(url, err);
        });
        
        // Устанавливаем заголовки для идентификации
        req.setHeader('User-Agent', 'FanFik-KeepAlive/1.0');
        req.setHeader('X-Keep-Alive', 'true');
        
        req.end();
    }
    
    tryAlternativeProtocol(url) {
        if (url.includes('https://')) {
            const httpUrl = url.replace('https://', 'http://');
            this.log(`🔄 Пробуем HTTP вместо HTTPS: ${httpUrl}`, 'RETRY');
            setTimeout(() => this.ping(httpUrl), 10000);
        } else if (url.includes('http://')) {
            const httpsUrl = url.replace('http://', 'https://');
            this.log(`🔄 Пробуем HTTPS вместо HTTP: ${httpsUrl}`, 'RETRY');
            setTimeout(() => this.ping(httpsUrl), 10000);
        }
    }
    
    analyzeHeaders(url, headers) {
        const interestingHeaders = {
            'server': 'Сервер',
            'x-powered-by': 'Технология',
            'x-render': 'Render',
            'cf-ray': 'Cloudflare'
        };
        
        for (const [header, description] of Object.entries(interestingHeaders)) {
            if (headers[header]) {
                this.log(`   ${description}: ${headers[header]}`, 'DEBUG');
            }
        }
    }
    
    autoRecovery(url, error) {
        // Пробуем переподключиться через 30 секунд
        setTimeout(() => {
            this.log(`🔄 Автоматическое восстановление для ${url}`, 'RECOVERY');
            this.ping(url);
        }, 30000);
    }
    
    healthCheck() {
        this.log('📊 Проверка состояния системы', 'HEALTH');
        
        // Проверка памяти
        const memoryUsage = process.memoryUsage();
        const usedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
        const totalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
        
        this.log(`   Память: ${usedMB}MB / ${totalMB}MB (${Math.round(usedMB/totalMB*100)}%)`, 'HEALTH');
        
        // Проверка uptime
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        this.log(`   Uptime: ${hours}ч ${minutes}м`, 'HEALTH');
        
        // Проверка активности URL
        this.log(`   Активных URL: ${this.urls.length}`, 'HEALTH');
    }
    
    monitorResources() {
        const memory = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        // Логируем только если использование высокое
        if (memory.heapUsed / memory.heapTotal > 0.8) {
            this.log(`⚠️  Высокое использование памяти: ${Math.round(memory.heapUsed/1024/1024)}MB`, 'WARNING');
        }
    }
    
    logStatus() {
        const now = new Date();
        const dateStr = now.toLocaleDateString('ru-RU');
        const timeStr = now.toLocaleTimeString('ru-RU');
        
        this.log('='.repeat(50), 'STATUS');
        this.log(`📈 СТАТУС СИСТЕМЫ - ${dateStr} ${timeStr}`, 'STATUS');
        this.log(`   Всего URL: ${this.urls.length}`, 'STATUS');
        this.log(`   Uptime: ${Math.floor(process.uptime() / 3600)} часов`, 'STATUS');
        this.log(`   Память: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`, 'STATUS');
        this.log('='.repeat(50), 'STATUS');
    }
    
    // Функция для тестирования
    async test() {
        console.log('\n🧪 ЗАПУСК ТЕСТОВОГО РЕЖИМА');
        console.log('='.repeat(40));
        
        // Тест всех URL
        for (const url of this.urls) {
            console.log(`Тестируем: ${url}`);
            const success = await this.testUrl(url);
            console.log(`  Результат: ${success ? '✅ Доступен' : '❌ Недоступен'}`);
        }
        
        console.log('='.repeat(40));
        console.log('Тест завершен\n');
    }
}

// Обработка командной строки
const args = process.argv.slice(2);

// Создаем экземпляр KeepAlive
const keepAlive = new KeepAlive();

// Обработка аргументов командной строки
if (args.includes('--test')) {
    keepAlive.test();
} else if (args.includes('--status')) {
    keepAlive.logStatus();
} else if (args.includes('--health')) {
    keepAlive.healthCheck();
} else if (args.includes('--help')) {
    console.log(`
🎯 Keep-Alive Script для FanFik Platform

Использование:
  node keep-alive.js           # Запуск в обычном режиме
  node keep-alive.js --test    # Тестовый режим
  node keep-alive.js --status  # Показать статус
  node keep-alive.js --health  # Проверка здоровья
  node keep-alive.js --help    # Эта справка

Переменные окружения:
  RENDER_URL                  # Основной URL на Render
  APP_URL                     # Альтернативный URL
  DOMAIN_NAME                 # Доменное имя
  RENDER_EXTERNAL_HOSTNAME    # Хостнейм от Render

Автоматически определяет URL и поддерживает активность сайта.
Интервал пинга: 4.5 минуты (оптимально для Render).
    `);
    process.exit(0);
}

// Обработка сигналов для graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Получен SIGINT...');
    keepAlive.log('Завершение работы по сигналу SIGINT', 'SHUTDOWN');
    setTimeout(() => {
        console.log('✅ Keep-Alive остановлен');
        process.exit(0);
    }, 1000);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Получен SIGTERM...');
    keepAlive.log('Завершение работы по сигналу SIGTERM', 'SHUTDOWN');
    setTimeout(() => {
        console.log('✅ Keep-Alive остановлен');
        process.exit(0);
    }, 1000);
});

process.on('uncaughtException', (error) => {
    keepAlive.log(`Неперехваченная ошибка: ${error.message}`, 'CRITICAL');
    console.error('❌ Критическая ошибка:', error);
    // Не завершаем процесс, продолжаем работу
});

process.on('unhandledRejection', (reason, promise) => {
    keepAlive.log(`Неперехваченный rejection: ${reason}`, 'CRITICAL');
    console.error('❌ Unhandled Rejection:', reason);
});

// Экспортируем для использования в других модулях
if (require.main !== module) {
    module.exports = KeepAlive;
} шлю
