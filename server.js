const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'agshfuh3y23rf7896r3fw2gy87f0387g7fwf0872g3fw78fg80273';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8518198310:AAF_XQE6pgR9QHBlTqMpoZjUDCt3aEkYBkI';
const SALT_ROUNDS = 10;

// Инициализация Telegram бота
let bot = null;
if (TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN !== 'your-telegram-bot-token') {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
    
    // Настройка вебхука для продакшена
    if (process.env.RENDER_URL) {
        const webhookUrl = `${process.env.RENDER_URL}/telegram-webhook`;
        bot.setWebHook(webhookUrl);
        
        app.post('/telegram-webhook', (req, res) => {
            bot.processUpdate(req.body);
            res.sendStatus(200);
        });
    } else {
        // Для разработки используем polling
        bot.startPolling();
    }
    
    // Обработчик команд бота
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        bot.sendMessage(chatId, 
            `👋 Привет, ${msg.from.first_name}!\n\n` +
            `Твой Telegram ID: \`${userId}\`\n\n` +
            `Скопируй этот ID и используй его для двухфакторной аутентификации на сайте.\n\n` +
            `Для привязки аккаунта:\n` +
            `1. Зарегистрируйся на сайте\n` +
            `2. При входе введи этот ID в поле Telegram ID\n` +
            `3. Получишь код подтверждения в этот чат`
        );
    });
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// Хранилище данных
let users = [];
let fics = [];
let twoFACodes = {};

// Загрузка данных
async function loadData() {
    try {
        const usersData = await fs.readFile('users.json', 'utf8');
        users = JSON.parse(usersData);
    } catch (error) {
        users = [];
        await saveUsers();
    }
    
    try {
        const ficsData = await fs.readFile('ff.json', 'utf8');
        fics = JSON.parse(ficsData);
    } catch (error) {
        fics = [];
        await saveFics();
    }
}

// Сохранение данных
async function saveUsers() {
    await fs.writeFile('users.json', JSON.stringify(users, null, 2));
}

async function saveFics() {
    await fs.writeFile('ff.json', JSON.stringify(fics, null, 2));
}

// Генерация 2FA кода
function generate2FACode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Middleware для проверки JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.sendStatus(401);
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// Проверка админских прав
function checkAdmin(req, res, next) {
    if (req.user.username !== 'horrygame') {
        return res.sendStatus(403);
    }
    next();
}

// Инициализация при запуске
loadData().then(() => {
    console.log('Данные загружены');
});

// API маршруты

// Регистрация
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        
        const user = {
            id: Date.now().toString(),
            username,
            password: hashedPassword,
            telegramId: null,
            isAdmin: username === 'horrygame',
            createdAt: new Date().toISOString(),
            lastLogin: null
        };
        
        users.push(user);
        await saveUsers();
        
        const token = jwt.sign({ 
            username: user.username, 
            isAdmin: user.isAdmin,
            userId: user.id 
        }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ 
            token, 
            user: { 
                username: user.username, 
                isAdmin: user.isAdmin,
                hasTelegram: !!user.telegramId
            } 
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Ошибка при регистрации' });
    }
});

// Вход
app.post('/api/login', async (req, res) => {
    const { username, password, telegramId } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    
    const user = users.find(u => u.username === username);
    if (!user) {
        return res.status(401).json({ error: 'Неверные данные' });
    }
    
    try {
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Неверные данные' });
        }
        
        // Если указан telegramId, отправляем 2FA код
        if (telegramId && bot && user.telegramId) {
            const code = generate2FACode();
            twoFACodes[username] = { code, telegramId: user.telegramId };
            
            try {
                await bot.sendMessage(user.telegramId, 
                    `🔐 Код подтверждения для входа: \`${code}\`\n\n` +
                    `Используй этот код на сайте для завершения входа.`
                );
                return res.json({ require2FA: true });
            } catch (error) {
                console.error('Telegram send error:', error);
                return res.status(500).json({ error: 'Ошибка отправки 2FA кода' });
            }
        }
        
        // Если код 2FA предоставлен
        if (twoFACodes[username] && telegramId) {
            const twoFA = twoFACodes[username];
            if (twoFA.code === telegramId) {
                delete twoFACodes[username];
                
                // Обновляем последний вход
                user.lastLogin = new Date().toISOString();
                await saveUsers();
                
                const token = jwt.sign({ 
                    username: user.username, 
                    isAdmin: user.isAdmin,
                    userId: user.id 
                }, JWT_SECRET, { expiresIn: '7d' });
                
                return res.json({ 
                    token, 
                    user: { 
                        username: user.username, 
                        isAdmin: user.isAdmin,
                        hasTelegram: !!user.telegramId
                    } 
                });
            } else {
                return res.status(401).json({ error: 'Неверный код 2FA' });
            }
        }
        
        // Без 2FA (если Telegram не привязан)
        if (!user.telegramId && telegramId) {
            // Привязываем Telegram ID
            user.telegramId = telegramId;
            await saveUsers();
        }
        
        // Обновляем последний вход
        user.lastLogin = new Date().toISOString();
        await saveUsers();
        
        const token = jwt.sign({ 
            username: user.username, 
            isAdmin: user.isAdmin,
            userId: user.id 
        }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ 
            token, 
            user: { 
                username: user.username, 
                isAdmin: user.isAdmin,
                hasTelegram: !!user.telegramId
            } 
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Ошибка при входе' });
    }
});

// Проверка авторизации
app.get('/api/check-auth', authenticateToken, (req, res) => {
    const user = users.find(u => u.username === req.user.username);
    if (user) {
        res.json({ 
            username: user.username, 
            isAdmin: user.isAdmin,
            hasTelegram: !!user.telegramId
        });
    } else {
        res.sendStatus(404);
    }
});

// Проверка админа
app.get('/api/check-admin', authenticateToken, checkAdmin, (req, res) => {
    res.json({ message: 'Admin access granted' });
});

// Получение статистики
app.get('/api/stats', authenticateToken, checkAdmin, (req, res) => {
    const totalFics = fics.length;
    const pendingFics = fics.filter(f => f.status === 'pending').length;
    const totalUsers = users.length;
    const telegramUsers = users.filter(u => u.telegramId).length;
    
    res.json({
        totalFics,
        pendingFics,
        totalUsers,
        telegramUsers
    });
});

// Получение фанфиков
app.get('/api/fics', (req, res) => {
    const approvedFics = fics.filter(fic => fic.status === 'approved');
    
    // Перемешиваем фанфики для "обновления рекомендаций"
    const shuffled = [...approvedFics].sort(() => Math.random() - 0.5);
    res.json(shuffled);
});

// Поиск фанфиков
app.get('/api/search', (req, res) => {
    const query = req.query.q?.toLowerCase() || '';
    const results = fics.filter(fic => 
        fic.status === 'approved' && 
        (fic.title.toLowerCase().includes(query) ||
         fic.author.toLowerCase().includes(query) ||
         fic.genre.some(g => g.toLowerCase().includes(query)))
    );
    
    // Сортируем по релевантности
    const sortedResults = results.sort((a, b) => {
        const aTitleMatch = a.title.toLowerCase().includes(query);
        const bTitleMatch = b.title.toLowerCase().includes(query);
        
        if (aTitleMatch && !bTitleMatch) return -1;
        if (!aTitleMatch && bTitleMatch) return 1;
        return 0;
    });
    
    res.json(sortedResults);
});

// Отправка фанфика на рассмотрение
app.post('/api/submit-fic', authenticateToken, async (req, res) => {
    try {
        const fic = {
            id: Date.now().toString(),
            ...req.body,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            submittedBy: req.user.username,
            status: 'pending',
            mark: null
        };
        
        fics.push(fic);
        await saveFics();
        res.json({ success: true, ficId: fic.id });
    } catch (error) {
        console.error('Submit fic error:', error);
        res.status(500).json({ error: 'Ошибка при отправке фанфика' });
    }
});

// Получение фанфиков на рассмотрении
app.get('/api/pending-fics', authenticateToken, checkAdmin, (req, res) => {
    const pendingFics = fics.filter(fic => fic.status === 'pending');
    res.json(pendingFics);
});

// Обновление статуса фанфика
app.post('/api/update-fic', authenticateToken, checkAdmin, async (req, res) => {
    const { ficId, status } = req.body;
    const ficIndex = fics.findIndex(fic => fic.id === ficId);
    
    if (ficIndex !== -1) {
        if (status === 'deleted') {
            fics.splice(ficIndex, 1);
        } else {
            fics[ficIndex].status = status;
            fics[ficIndex].updatedAt = new Date().toISOString();
            
            // Уведомляем автора через Telegram, если возможно
            if (bot && status === 'approved') {
                const author = users.find(u => u.username === fics[ficIndex].submittedBy);
                if (author && author.telegramId) {
                    try {
                        await bot.sendMessage(author.telegramId,
                            `🎉 Твой фанфик "${fics[ficIndex].title}" был одобрен!\n\n` +
                            `Теперь он доступен для чтения всем пользователям на сайте.`
                        );
                    } catch (error) {
                        console.error('Telegram notification error:', error);
                    }
                }
            }
        }
        await saveFics();
    }
    
    res.json({ success: true });
});

// Установка метки фанфику
app.post('/api/set-mark', authenticateToken, checkAdmin, async (req, res) => {
    const { ficId, mark } = req.body;
    const fic = fics.find(fic => fic.id === ficId);
    
    if (fic) {
        fic.mark = mark;
        fic.updatedAt = new Date().toISOString();
        await saveFics();
    }
    
    res.json({ success: true });
});

// Обновление возрастного рейтинга
app.post('/api/update-age', authenticateToken, checkAdmin, async (req, res) => {
    const { ficId, age } = req.body;
    const fic = fics.find(fic => fic.id === ficId);
    
    if (fic) {
        fic.age = age;
        fic.updatedAt = new Date().toISOString();
        await saveFics();
    }
    
    res.json({ success: true });
});

// Экспорт фанфиков
app.get('/api/export/fics', authenticateToken, checkAdmin, (req, res) => {
    res.json({
        exportedAt: new Date().toISOString(),
        total: fics.length,
        fics: fics
    });
});

// Экспорт пользователей (без паролей)
app.get('/api/export/users', authenticateToken, checkAdmin, (req, res) => {
    const safeUsers = users.map(user => ({
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
        telegramId: user.telegramId,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        hasPassword: !!user.password
    }));
    
    res.json({
        exportedAt: new Date().toISOString(),
        total: users.length,
        users: safeUsers
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📚 Всего пользователей: ${users.length}`);
    console.log(`📖 Всего фанфиков: ${fics.length}`);
    console.log(`🤖 Telegram бот: ${bot ? 'активен' : 'не настроен'}`);
});

// Функция для поддержания активности сервера (для Render)
setInterval(() => {
    console.log('🔄 Keep-alive ping');
    
    // Пингуем себя для предотвращения засыпания
    if (process.env.RENDER_URL) {
        https.get(process.env.RENDER_URL, (res) => {
            console.log(`✅ Сервер активен: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error('❌ Keep-alive error:', err.message);
        });
    }
}, 5 * 60 * 1000); // Каждые 5 минут

// Обновление рекомендаций каждые 30 минут
setInterval(() => {
    console.log('🔄 Обновление рекомендаций');
}, 30 * 60 * 1000);

// Экспортируем для тестов
module.exports = { app, users, fics };
