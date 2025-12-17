const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const { JSONFile, Low } = require('lowdb');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка базы данных
const adapter = new JSONFile('ff.json');
const db = new Low(adapter);

// Инициализация базы данных
async function initializeDB() {
    await db.read();
    db.data = db.data || { 
        users: [], 
        fanfics: [], 
        pendingFanfics: [], 
        adminStats: { lastRecommendationShuffle: Date.now() } 
    };
    await db.write();
}

initializeDB();

// Настройка сессий
app.use(session({
    secret: process.env.SESSION_SECRET || 'fanfic-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 часа
    }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Конфигурация Telegram бота
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Хранилище для 2FA кодов
const twoFACodes = new Map();

// Генерация 6-значного кода
function generate2FACode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Проверка аутентификации
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    next();
}

// Проверка админских прав
function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.username !== 'horrygame') {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }
    next();
}

// Middleware для логирования запросов
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

// API эндпоинты

// Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Заполните все поля' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Пароль должен быть не менее 6 символов' });
        }
        
        await db.read();
        const existingUser = db.data.users.find(u => u.username === username);
        
        if (existingUser) {
            return res.json({ success: false, message: 'Пользователь уже существует' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = {
            id: uuidv4(),
            username,
            password: hashedPassword,
            isAdmin: username === 'horrygame',
            registeredAt: new Date().toISOString()
        };
        
        db.data.users.push(user);
        await db.write();
        
        console.log(`Зарегистрирован новый пользователь: ${username}`);
        res.json({ success: true, message: 'Регистрация успешна' });
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Логин
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Заполните все поля' });
        }
        
        await db.read();
        const user = db.data.users.find(u => u.username === username);
        
        if (!user) {
            return res.json({ success: false, message: 'Неверный логин или пароль' });
        }
        
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.json({ success: false, message: 'Неверный логин или пароль' });
        }
        
        // Генерация кода 2FA
        const code = generate2FACode();
        twoFACodes.set(username, { code, timestamp: Date.now(), userId: user.id });
        
        console.log(`Сгенерирован 2FA код для ${username}: ${code}`);
        
        // В демо-режиме возвращаем код напрямую
        res.json({ 
            success: true, 
            requires2FA: true, 
            message: `Код 2FA отправлен в Telegram: ${code} (для демо)`,
            username: username
        });
    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Верификация 2FA
app.post('/api/verify-2fa', async (req, res) => {
    try {
        const { username, code } = req.body;
        
        if (!username || !code) {
            return res.status(400).json({ success: false, message: 'Заполните все поля' });
        }
        
        const twoFA = twoFACodes.get(username);
        
        if (!twoFA) {
            return res.json({ success: false, message: 'Код не найден или истек' });
        }
        
        if (twoFA.code !== code) {
            return res.json({ success: false, message: 'Неверный код' });
        }
        
        // Проверка времени действия кода (10 минут)
        if (Date.now() - twoFA.timestamp > 10 * 60 * 1000) {
            twoFACodes.delete(username);
            return res.json({ success: false, message: 'Код истек' });
        }
        
        await db.read();
        const user = db.data.users.find(u => u.username === username);
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'Пользователь не найден' });
        }
        
        req.session.user = {
            id: user.id,
            username: user.username,
            isAdmin: user.isAdmin
        };
        
        twoFACodes.delete(username);
        console.log(`Успешная аутентификация: ${username}`);
        res.json({ success: true, user: req.session.user });
    } catch (error) {
        console.error('Ошибка верификации 2FA:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Получение текущего пользователя
app.get('/api/user', (req, res) => {
    res.json({ user: req.session.user || null });
});

// Выход
app.post('/api/logout', (req, res) => {
    if (req.session.user) {
        console.log(`Выход пользователя: ${req.session.user.username}`);
    }
    req.session.destroy();
    res.json({ success: true });
});

// Получение фанфиков
app.get('/api/fanfics', async (req, res) => {
    try {
        await db.read();
        res.json({ fanfics: db.data.fanfics });
    } catch (error) {
        console.error('Ошибка получения фанфиков:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Поиск фанфиков
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q?.toLowerCase();
        
        await db.read();
        let fanfics = db.data.fanfics;
        
        if (query) {
            fanfics = fanfics.filter(f => 
                f.title?.toLowerCase().includes(query) ||
                f.author?.toLowerCase().includes(query) ||
                f.genre?.toLowerCase().includes(query)
            );
        }
        
        res.json({ fanfics });
    } catch (error) {
        console.error('Ошибка поиска:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отправка фанфика на рассмотрение
app.post('/api/submit-fanfic', requireAuth, async (req, res) => {
    try {
        const { title, genre, ageRating, author, chapters } = req.body;
        
        if (!title || !genre || !ageRating || !author || !chapters || !Array.isArray(chapters)) {
            return res.status(400).json({ success: false, message: 'Заполните все поля' });
        }
        
        await db.read();
        
        const fanfic = {
            id: uuidv4(),
            title,
            genre,
            ageRating,
            author,
            chapters: chapters.map(chapter => ({
                id: uuidv4(),
                title: chapter.title || 'Без названия',
                content: chapter.content || '',
                createdAt: new Date().toISOString()
            })),
            submittedBy: req.session.user.username,
            submittedAt: new Date().toISOString(),
            status: 'pending',
            views: 0
        };
        
        db.data.pendingFanfics.push(fanfic);
        await db.write();
        
        console.log(`Новый фанфик отправлен на модерацию: "${title}" от ${author}`);
        res.json({ 
            success: true, 
            message: 'Фанфик отправлен на рассмотрение',
            fanficId: fanfic.id 
        });
    } catch (error) {
        console.error('Ошибка отправки фанфика:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Админские эндпоинты

// Получение фанфиков на рассмотрении
app.get('/api/admin/pending', requireAdmin, async (req, res) => {
    try {
        await db.read();
        res.json({ fanfics: db.data.pendingFanfics });
    } catch (error) {
        console.error('Ошибка получения фанфиков на модерации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление статуса фанфика
app.post('/api/admin/update-fanfic', requireAdmin, async (req, res) => {
    try {
        const { id, status, officialMark, ageRating } = req.body;
        
        if (!id || !status) {
            return res.status(400).json({ success: false, message: 'Не указаны обязательные поля' });
        }
        
        await db.read();
        const index = db.data.pendingFanfics.findIndex(f => f.id === id);
        
        if (index === -1) {
            return res.status(404).json({ success: false, message: 'Фанфик не найден' });
        }
        
        const fanfic = db.data.pendingFanfics[index];
        
        if (status === 'approved') {
            fanfic.officialMark = officialMark || null;
            fanfic.ageRating = ageRating || fanfic.ageRating;
            fanfic.publishedAt = new Date().toISOString();
            fanfic.status = 'published';
            db.data.fanfics.push(fanfic);
            
            console.log(`Фанфик одобрен: "${fanfic.title}"`);
        } else if (status === 'rejected') {
            console.log(`Фанфик отклонен: "${fanfic.title}"`);
        }
        
        db.data.pendingFanfics.splice(index, 1);
        await db.write();
        
        res.json({ success: true, message: `Фанфик ${status === 'approved' ? 'одобрен' : 'отклонен'}` });
    } catch (error) {
        console.error('Ошибка обновления фанфика:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Удаление фанфика
app.delete('/api/admin/fanfic/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.read();
        const index = db.data.fanfics.findIndex(f => f.id === id);
        
        if (index === -1) {
            return res.status(404).json({ success: false, message: 'Фанфик не найден' });
        }
        
        const deletedFanfic = db.data.fanfics[index];
        db.data.fanfics.splice(index, 1);
        await db.write();
        
        console.log(`Фанфик удален: "${deletedFanfic.title}"`);
        res.json({ success: true, message: 'Фанфик удален' });
    } catch (error) {
        console.error('Ошибка удаления фанфика:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Перемешивание рекомендаций
app.post('/api/admin/shuffle-recommendations', requireAdmin, async (req, res) => {
    try {
        await db.read();
        
        // Перемешиваем фанфики
        for (let i = db.data.fanfics.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [db.data.fanfics[i], db.data.fanfics[j]] = [db.data.fanfics[j], db.data.fanfics[i]];
        }
        
        db.data.adminStats.lastRecommendationShuffle = Date.now();
        await db.write();
        
        console.log('Рекомендации перемешаны вручную');
        res.json({ success: true, message: 'Рекомендации перемешаны' });
    } catch (error) {
        console.error('Ошибка перемешивания рекомендаций:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Статистика для админа
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        await db.read();
        
        const stats = {
            totalUsers: db.data.users.length,
            totalFanfics: db.data.fanfics.length,
            pendingFanfics: db.data.pendingFanfics.length,
            lastShuffle: db.data.adminStats.lastRecommendationShuffle
                ? new Date(db.data.adminStats.lastRecommendationShuffle).toLocaleString('ru-RU')
                : null
        };
        
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Ошибка получения статистики:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Маршруты для HTML страниц
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Health check endpoint для Render
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Fanfiction Site'
    });
});

// Автоматическое перемешивание каждые 30 минут
setInterval(async () => {
    try {
        await db.read();
        
        if (db.data.fanfics.length > 1) {
            // Перемешиваем фанфики
            for (let i = db.data.fanfics.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [db.data.fanfics[i], db.data.fanfics[j]] = [db.data.fanfics[j], db.data.fanfics[i]];
            }
            
            db.data.adminStats.lastRecommendationShuffle = Date.now();
            await db.write();
            
            console.log('Рекомендации перемешаны автоматически');
        }
    } catch (error) {
        console.error('Ошибка автоматического перемешивания:', error);
    }
}, 30 * 60 * 1000); // 30 минут

// Обработка 404
app.use((req, res) => {
    res.status(404).json({ error: 'Страница не найдена' });
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('Необработанная ошибка:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Сайт доступен по адресу: http://localhost:${PORT}`);
    console.log(`👑 Админский аккаунт: horrygame`);
});
