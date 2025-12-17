const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { JSONFile, Low } = require('lowdb');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Важно для Render: всегда используйте порт из переменной окружения
const port = process.env.PORT || 3000;

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
    secret: process.env.SESSION_SECRET || 'dev-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Middleware для CORS (важно для Render)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Хранилище для 2FA кодов
const twoFACodes = new Map();

function generate2FACode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.username !== 'horrygame') {
        return res.status(403).json({ error: 'Доступ запрещен' });
    }
    next();
}

// === КРИТИЧЕСКИ ВАЖНО: Health Check для Render ===
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        port: port,
        environment: process.env.NODE_ENV || 'development'
    });
});

// === ОСНОВНЫЕ API ЭНДПОИНТЫ ===

// Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Заполните все поля' });
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
        
        await db.read();
        const user = db.data.users.find(u => u.username === username);
        
        if (!user) {
            return res.json({ success: false, message: 'Неверный логин или пароль' });
        }
        
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.json({ success: false, message: 'Неверный логин или пароль' });
        }
        
        const code = generate2FACode();
        twoFACodes.set(username, { code, timestamp: Date.now(), userId: user.id });
        
        res.json({ 
            success: true, 
            requires2FA: true, 
            message: `Код 2FA: ${code}`,
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
        
        const twoFA = twoFACodes.get(username);
        
        if (!twoFA || twoFA.code !== code) {
            return res.json({ success: false, message: 'Неверный код' });
        }
        
        await db.read();
        const user = db.data.users.find(u => u.username === username);
        
        req.session.user = {
            id: user.id,
            username: user.username,
            isAdmin: user.isAdmin
        };
        
        twoFACodes.delete(username);
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

// Отправка фанфика
app.post('/api/submit-fanfic', requireAuth, async (req, res) => {
    try {
        const { title, genre, ageRating, author, chapters } = req.body;
        
        await db.read();
        
        const fanfic = {
            id: uuidv4(),
            title,
            genre,
            ageRating,
            author,
            chapters: chapters || [],
            submittedBy: req.session.user.username,
            submittedAt: new Date().toISOString(),
            status: 'pending'
        };
        
        db.data.pendingFanfics.push(fanfic);
        await db.write();
        
        res.json({ 
            success: true, 
            message: 'Фанфик отправлен на рассмотрение'
        });
    } catch (error) {
        console.error('Ошибка отправки фанфика:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// === АДМИНСКИЕ ЭНДПОИНТЫ ===

app.get('/api/admin/pending', requireAdmin, async (req, res) => {
    try {
        await db.read();
        res.json({ fanfics: db.data.pendingFanfics });
    } catch (error) {
        console.error('Ошибка получения фанфиков на модерации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/admin/update-fanfic', requireAdmin, async (req, res) => {
    try {
        const { id, status, officialMark, ageRating } = req.body;
        
        await db.read();
        const index = db.data.pendingFanfics.findIndex(f => f.id === id);
        
        if (index === -1) {
            return res.status(404).json({ success: false, message: 'Фанфик не найден' });
        }
        
        const fanfic = db.data.pendingFanfics[index];
        
        if (status === 'approved') {
            fanfic.officialMark = officialMark;
            fanfic.ageRating = ageRating;
            fanfic.publishedAt = new Date().toISOString();
            db.data.fanfics.push(fanfic);
        }
        
        db.data.pendingFanfics.splice(index, 1);
        await db.write();
        
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка обновления фанфика:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.delete('/api/admin/fanfic/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.read();
        const index = db.data.fanfics.findIndex(f => f.id === id);
        
        if (index === -1) {
            return res.status(404).json({ success: false, message: 'Фанфик не найден' });
        }
        
        db.data.fanfics.splice(index, 1);
        await db.write();
        
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка удаления фанфика:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

app.post('/api/admin/shuffle-recommendations', requireAdmin, async (req, res) => {
    try {
        await db.read();
        
        for (let i = db.data.fanfics.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [db.data.fanfics[i], db.data.fanfics[j]] = [db.data.fanfics[j], db.data.fanfics[i]];
        }
        
        db.data.adminStats.lastRecommendationShuffle = Date.now();
        await db.write();
        
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка перемешивания рекомендаций:', error);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// === HTML СТРАНИЦЫ ===
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// === ОБРАБОТКА ОШИБОК ===
app.use((req, res) => {
    res.status(404).json({ error: 'Страница не найдена' });
});

app.use((err, req, res, next) => {
    console.error('Ошибка сервера:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// === КРИТИЧЕСКИ ВАЖНО: Запуск сервера ===
const server = app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${port}`);
    console.log(`🌐 Локальный URL: http://localhost:${port}`);
    console.log(`📡 Внешний URL: http://0.0.0.0:${port}`);
    console.log(`🔧 Режим: ${process.env.NODE_ENV || 'development'}`);
    
    // Проверка подключения
    console.log(`🔍 Health check доступен по: http://0.0.0.0:${port}/health`);
    
    // Автоматическое перемешивание
    setInterval(async () => {
        try {
            await db.read();
            if (db.data.fanfics.length > 1) {
                for (let i = db.data.fanfics.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [db.data.fanfics[i], db.data.fanfics[j]] = [db.data.fanfics[j], db.data.fanfics[i]];
                }
                db.data.adminStats.lastRecommendationShuffle = Date.now();
                await db.write();
                console.log('🔄 Рекомендации перемешаны автоматически');
            }
        } catch (error) {
            console.error('Ошибка автоматического перемешивания:', error);
        }
    }, 30 * 60 * 1000);
});

// Обработка graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Получен SIGTERM, завершаю работу...');
    server.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Получен SIGINT, завершаю работу...');
    server.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});
